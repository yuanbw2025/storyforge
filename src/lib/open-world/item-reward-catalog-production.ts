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
  TextOpenWorldEnemyEncounterCatalogV1,
  TextOpenWorldGameplayRulesetSkeletonV1,
  TextOpenWorldItemRewardCatalogV1,
  TextOpenWorldPlayerBuildV1,
  TextOpenWorldProgressionCatalogsV1,
  TextOpenWorldQuestSkeletonsV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { validateTextOpenWorldGameplayRulesetSkeletonV1 } from './gameplay-ruleset'

const SKILL_ID = 'text-open-world.production.item-reward-catalog.v1'
const MAX_CONTEXT_CHARS = 320_000
type ItemKindV1 = 'equipment' | 'consumable' | 'material' | 'quest' | 'misc'
const EQUIPMENT_SLOTS = ['weapon', 'armor', 'accessory'] as const
/**
 * Quest planning uses the broad `item` requirement kind. This reserved trait
 * is the narrow, governed bridge that lets the deterministic catalog compiler
 * distinguish a usable consumable from flavour-only miscellaneous loot.
 */
export const TEXT_OPEN_WORLD_RUNTIME_CONSUMABLE_TRAIT_V1 = 'runtime-consumable' as const

interface ItemDemandV1 {
  demandNumber: number
  sourceDemandKey: string
  demandKind: 'player-initial' | 'content-requirement' | 'region-drop-material'
  fixedItemKey: string | null
  fixedTitle: string | null
  fixedDescription: string | null
  plannedKind: ItemKindV1
  fixedEquipmentSlotKey: typeof EQUIPMENT_SLOTS[number] | null
  requirementKey: string | null
  criticality: 'ordinary' | 'important' | 'protected'
  semanticBrief: string
  requestedTraits: string[]
  regionKey: string | null
}

interface RewardDemandV1 {
  demandNumber: number
  sourceDemandKey: string
  sourceKind: 'quest' | 'combat'
  sourceSemanticKey: string
  title: string
  semanticBrief: string
  expectedMinutes: number
  requirementKeys: string[]
  mandatoryItemDemandNumbers: number[]
  mandatorySkillKeys: string[]
}

export interface TextOpenWorldItemRewardCatalogInputContextV1 {
  schema: 'storyforge.text-open-world-item-reward-catalog-input'
  version: 1
  productInstanceKey: string
  gameplayRuleset: TextOpenWorldGameplayRulesetSkeletonV1
  playerBuild: TextOpenWorldPlayerBuildV1
  questSkeletons: TextOpenWorldQuestSkeletonsV1
  contentRequirementManifest: TextOpenWorldContentRequirementManifestV1
  progressionCatalogs: TextOpenWorldProgressionCatalogsV1
  enemyEncounterCatalog: TextOpenWorldEnemyEncounterCatalogV1
  itemDemands: ItemDemandV1[]
  rewardDemands: RewardDemandV1[]
  contextSelectionHash: string
}

export interface TextOpenWorldItemRewardCatalogModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldItemRewardCatalogModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  expectedCapabilityHash: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldItemRewardCatalogModelExecutionV1>

interface CatalogDraftV1 {
  items: Array<{
    demandNumber: number
    title: string
    description: string
    tags: string[]
    equipmentSlotKey: typeof EQUIPMENT_SLOTS[number] | null
  }>
  rewards: Array<{
    demandNumber: number
    title: string
    description: string
    optionalItemDemandNumbers: number[]
  }>
}

function fail(message: string): never { throw new Error(`[text-open-world-item-reward-catalog] ${message}`) }
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
function nullableEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T | null {
  if (value === null) return null
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label}不在允许闭集`)
  return value as T
}
function stringArray(value: unknown, label: string, maximum: number, allowEmpty = false): string[] {
  if (!Array.isArray(value) || value.length > maximum || (!allowEmpty && value.length < 1)) fail(`${label}必须是有界数组`)
  const result = value.map((item, index) => text(item, `${label}[${index}]`, 300))
  if (new Set(result).size !== result.length) fail(`${label}不得重复`)
  return result
}
function integerArray(value: unknown, label: string, maximum: number, itemMaximum: number): number[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label}必须是最多${maximum}项数组`)
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

function questKeyForObjective(quests: TextOpenWorldQuestSkeletonsV1, objectiveKey: string): string {
  const objective = quests.objectives.find(item => item.key === objectiveKey) ?? fail(`未知Objective:${objectiveKey}`)
  return objective.questKey
}

function buildItemDemands(input: {
  playerBuild: TextOpenWorldPlayerBuildV1
  manifest: TextOpenWorldContentRequirementManifestV1
  encounterCatalog: TextOpenWorldEnemyEncounterCatalogV1
}): ItemDemandV1[] {
  const demands: ItemDemandV1[] = []
  input.playerBuild.catalogRequirements.items.forEach(item => demands.push({
    demandNumber: demands.length + 1, sourceDemandKey: `player-build.${item.key}`, demandKind: 'player-initial',
    fixedItemKey: item.key, fixedTitle: item.title, fixedDescription: item.description, plannedKind: item.kind,
    fixedEquipmentSlotKey: item.equipmentSlotKey, requirementKey: null, criticality: 'important',
    semanticBrief: item.role === 'starter-weapon' ? '主角开局可装备武器。' : '主角开局拥有三份的恢复消耗品。',
    requestedTraits: [item.role], regionKey: null,
  }))
  const requirements = input.manifest.requirements.filter(requirement => requirement.ownerTaskKey === 'p8.catalog.items-rewards'
    && requirement.kind !== 'reward')
  requirements.forEach(requirement => {
    if (!['item', 'equipment', 'material'].includes(requirement.kind) || requirement.sourceReservationKey !== null
      || requirement.binding.status !== 'catalog-unbound' || requirement.binding.definitionKeys.length) fail(`物品目录收到非法需求:${requirement.key}`)
    const plannedKind = requirement.kind === 'equipment' ? 'equipment'
      : requirement.kind === 'material' ? 'material'
        : requirement.criticality === 'protected' ? 'quest'
          : requirement.requestedTraits.includes(TEXT_OPEN_WORLD_RUNTIME_CONSUMABLE_TRAIT_V1)
            ? 'consumable'
            : 'misc'
    for (let index = 0; index < requirement.minimumCount; index += 1) demands.push({
      demandNumber: demands.length + 1,
      sourceDemandKey: `${requirement.key}.${String(index + 1).padStart(3, '0')}`,
      demandKind: 'content-requirement', fixedItemKey: null,
      fixedTitle: requirement.minimumCount === 1 ? requirement.title : `${requirement.title} ${index + 1}`,
      fixedDescription: requirement.description, plannedKind,
      fixedEquipmentSlotKey: null, requirementKey: requirement.key, criticality: requirement.criticality,
      semanticBrief: requirement.description, requestedTraits: requirement.requestedTraits, regionKey: null,
    })
  })
  const regionKeys = [...new Set(input.encounterCatalog.encounters.map(encounter => encounter.regionKey))]
  regionKeys.forEach(regionKey => demands.push({
    demandNumber: demands.length + 1, sourceDemandKey: `region-drop-material.${regionKey}`, demandKind: 'region-drop-material',
    fixedItemKey: null, fixedTitle: null, fixedDescription: null, plannedKind: 'material', fixedEquipmentSlotKey: null,
    requirementKey: null, criticality: 'ordinary', semanticBrief: `来自${regionKey}普通敌人的基础制作与交易材料。`,
    requestedTraits: ['地区掉落', '制作材料', '可出售'], regionKey,
  }))
  if (demands.length > 100) fail('物品需求超过单Build首版上限100')
  return demands
}

function buildRewardDemands(input: {
  quests: TextOpenWorldQuestSkeletonsV1
  manifest: TextOpenWorldContentRequirementManifestV1
  progression: TextOpenWorldProgressionCatalogsV1
  encounters: TextOpenWorldEnemyEncounterCatalogV1
  items: ItemDemandV1[]
}): RewardDemandV1[] {
  const demands: RewardDemandV1[] = []
  const rewardRequirements = input.manifest.requirements.filter(requirement => requirement.ownerTaskKey === 'p8.catalog.items-rewards' && requirement.kind === 'reward')
  const itemRequirementDemandNumbers = new Map<string, number[]>()
  input.items.filter(item => item.requirementKey !== null).forEach(item => {
    const rows = itemRequirementDemandNumbers.get(item.requirementKey!) ?? []; rows.push(item.demandNumber); itemRequirementDemandNumbers.set(item.requirementKey!, rows)
  })
  input.quests.quests.forEach(quest => {
    const objectiveKeys = input.quests.objectives.filter(objective => objective.questKey === quest.key).map(objective => objective.key)
    const consumedRequirements = input.manifest.requirements.filter(requirement => requirement.consumerRefs.some(ref =>
      ref.kind === 'quest-objective' && objectiveKeys.includes(ref.consumerKey)))
    const rewardRequirementKeys = consumedRequirements.filter(requirement => requirement.kind === 'reward').map(requirement => requirement.key)
    const mandatoryItemDemandNumbers = consumedRequirements.flatMap(requirement => itemRequirementDemandNumbers.get(requirement.key) ?? [])
    const mandatorySkillKeys = input.progression.skills.filter(skill => skill.fulfilledRequirementKeys.some(key =>
      consumedRequirements.some(requirement => requirement.key === key))).map(skill => skill.key)
    demands.push({
      demandNumber: demands.length + 1, sourceDemandKey: `quest-reward.${quest.key}`, sourceKind: 'quest', sourceSemanticKey: quest.key,
      title: `${quest.title}奖励`, semanticBrief: `${quest.storyMotivation}；奖励必须支持${quest.intendedPlayerExperience}`,
      expectedMinutes: quest.estimatedMinutes, requirementKeys: rewardRequirementKeys,
      mandatoryItemDemandNumbers: [...new Set(mandatoryItemDemandNumbers)], mandatorySkillKeys,
    })
  })
  rewardRequirements.forEach(requirement => {
    const existing = demands.filter(demand => demand.requirementKeys.includes(requirement.key)).length
    for (let index = existing; index < requirement.minimumCount; index += 1) {
      const objectiveKey = requirement.consumerRefs.find(ref => ref.kind === 'quest-objective')?.consumerKey
      const questKey = objectiveKey ? questKeyForObjective(input.quests, objectiveKey) : input.quests.quests[0]!.key
      demands.push({
        demandNumber: demands.length + 1, sourceDemandKey: `supplemental-reward.${requirement.key}.${String(index + 1).padStart(3, '0')}`,
        sourceKind: 'quest', sourceSemanticKey: questKey, title: `${requirement.title}补充奖励${index + 1}`,
        semanticBrief: requirement.description, expectedMinutes: 0, requirementKeys: [requirement.key],
        mandatoryItemDemandNumbers: [], mandatorySkillKeys: [],
      })
    }
  })
  input.encounters.encounters.forEach(encounter => demands.push({
    demandNumber: demands.length + 1, sourceDemandKey: encounter.runtimeBinding.rewardRequirementKey,
    sourceKind: 'combat', sourceSemanticKey: encounter.key, title: `${encounter.title}战斗奖励`,
    semanticBrief: `按${encounter.intensity}强度与${encounter.recommendedLevel}级推荐值提供成长回报。`,
    expectedMinutes: 8 + encounter.recommendedLevel * 2, requirementKeys: [], mandatoryItemDemandNumbers: [], mandatorySkillKeys: [],
  }))
  if (demands.length > 160) fail('奖励需求超过单Build首版上限160')
  return demands
}

async function validateUpstream(context: Omit<TextOpenWorldItemRewardCatalogInputContextV1, 'contextSelectionHash'>): Promise<void> {
  const { gameplayRuleset, playerBuild, questSkeletons, contentRequirementManifest, progressionCatalogs, enemyEncounterCatalog } = context
  await validateTextOpenWorldGameplayRulesetSkeletonV1({ artifact: gameplayRuleset })
  for (const [value, hashKey, label] of [
    [playerBuild, 'playerBuildHash', 'PlayerBuild'], [questSkeletons, 'questSkeletonsHash', 'QuestSkeletons'],
    [contentRequirementManifest, 'contentRequirementManifestHash', 'Manifest'], [progressionCatalogs, 'progressionCatalogsHash', 'ProgressionCatalogs'],
    [enemyEncounterCatalog, 'enemyEncounterCatalogHash', 'EnemyEncounterCatalog'],
  ] as const) await assertOwnHash(value as unknown as Record<string, unknown>, hashKey, label)
  if ([playerBuild, questSkeletons, contentRequirementManifest, progressionCatalogs, enemyEncounterCatalog]
    .some(value => value.productInstanceKey !== context.productInstanceKey)
    || contentRequirementManifest.questSkeletonsHash !== questSkeletons.questSkeletonsHash
    || progressionCatalogs.questSkeletonsHash !== questSkeletons.questSkeletonsHash
    || enemyEncounterCatalog.questSkeletonsHash !== questSkeletons.questSkeletonsHash
    || enemyEncounterCatalog.progressionCatalogsHash !== progressionCatalogs.progressionCatalogsHash
    || enemyEncounterCatalog.governance.rewardsAndDropsDeferred !== true) fail('ItemReward Catalog上游身份、引用或延迟绑定边界无效')
  const items = buildItemDemands({ playerBuild, manifest: contentRequirementManifest, encounterCatalog: enemyEncounterCatalog })
  const rewards = buildRewardDemands({ quests: questSkeletons, manifest: contentRequirementManifest, progression: progressionCatalogs, encounters: enemyEncounterCatalog, items })
  if (canonicalProductProductionJsonV2(items) !== canonicalProductProductionJsonV2(context.itemDemands)
    || canonicalProductProductionJsonV2(rewards) !== canonicalProductProductionJsonV2(context.rewardDemands)) fail('item/reward demands不是上游确定性投影')
}

async function loadContext(input: { scope: WorkspaceScope; productionId: number; buildId: number }): Promise<TextOpenWorldItemRewardCatalogInputContextV1> {
  const [production, build, rows] = await Promise.all([
    db.productProductions.get(input.productionId), db.productBuilds.get(input.buildId), readAcceptedBuildArtifacts({ scope: input.scope, buildId: input.buildId }),
  ])
  if (!production || production.productType !== 'text-open-world'
    || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) fail('Production不存在、跨Work或类型错误')
  if (!build || build.productionId !== production.id
    || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) fail('Build不属于当前Production/Work')
  const keys = [
    'text-open-world.gameplay-ruleset-skeleton', 'text-open-world.player-build', 'text-open-world.quest-skeletons',
    'text-open-world.content-requirement-manifest', 'text-open-world.progression-catalogs', 'text-open-world.enemy-encounter-catalog',
  ] as const
  const rowsByKey = Object.fromEntries(keys.map(key => [key, unique(rows, key)])) as Record<typeof keys[number], ProductBuildArtifactRecordV1>
  const gameplayRuleset = artifact<TextOpenWorldGameplayRulesetSkeletonV1>(rowsByKey[keys[0]], keys[0])
  const playerBuild = artifact<TextOpenWorldPlayerBuildV1>(rowsByKey[keys[1]], keys[1])
  const questSkeletons = artifact<TextOpenWorldQuestSkeletonsV1>(rowsByKey[keys[2]], keys[2])
  const contentRequirementManifest = artifact<TextOpenWorldContentRequirementManifestV1>(rowsByKey[keys[3]], keys[3])
  const progressionCatalogs = artifact<TextOpenWorldProgressionCatalogsV1>(rowsByKey[keys[4]], keys[4])
  const enemyEncounterCatalog = artifact<TextOpenWorldEnemyEncounterCatalogV1>(rowsByKey[keys[5]], keys[5])
  const payloads = [gameplayRuleset, playerBuild, questSkeletons, contentRequirementManifest, progressionCatalogs, enemyEncounterCatalog]
  for (let index = 0; index < keys.length; index += 1) if (await hashProductProductionValueV2(payloads[index]) !== rowsByKey[keys[index]].contentHash) fail(`Artifact行Hash不匹配:${keys[index]}`)
  const itemDemands = buildItemDemands({ playerBuild, manifest: contentRequirementManifest, encounterCatalog: enemyEncounterCatalog })
  const rewardDemands = buildRewardDemands({ quests: questSkeletons, manifest: contentRequirementManifest, progression: progressionCatalogs, encounters: enemyEncounterCatalog, items: itemDemands })
  const body: Omit<TextOpenWorldItemRewardCatalogInputContextV1, 'contextSelectionHash'> = {
    schema: 'storyforge.text-open-world-item-reward-catalog-input', version: 1, productInstanceKey: production.productionKey,
    gameplayRuleset, playerBuild, questSkeletons, contentRequirementManifest, progressionCatalogs, enemyEncounterCatalog,
    itemDemands, rewardDemands,
  }
  await validateUpstream(body)
  const context = { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('ItemReward Catalog Context超过硬上限')
  return context
}

export async function readTextOpenWorldItemRewardCatalogInputContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !Number.isSafeInteger(input.productProductionId) || !Number.isSafeInteger(input.productBuildId)) fail('Context读取缺少scope/production/build selector')
  return canonicalProductProductionJsonV2(await loadContext({ scope: input.scope, productionId: input.productProductionId!, buildId: input.productBuildId! }))
}

async function parseContext(value: string): Promise<TextOpenWorldItemRewardCatalogInputContextV1> {
  let context: TextOpenWorldItemRewardCatalogInputContextV1
  try { context = JSON.parse(value) as TextOpenWorldItemRewardCatalogInputContextV1 } catch { return fail('Context JSON损坏') }
  if (context.schema !== 'storyforge.text-open-world-item-reward-catalog-input' || context.version !== 1) fail('Context身份无效')
  const { contextSelectionHash, ...body } = context; await validateUpstream(body)
  if (!isSha256Hash(contextSelectionHash) || await hashProductProductionValueV2(body) !== contextSelectionHash) fail('Context选择Hash不匹配')
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Context超过硬上限')
  return context
}

function parseDraft(value: unknown, context: TextOpenWorldItemRewardCatalogInputContextV1): CatalogDraftV1 {
  const root = record(value, 'draft'); exactKeys(root, ['schema', 'version', 'items', 'rewards'], 'draft')
  if (root.schema !== 'storyforge.text-open-world-item-reward-catalog-draft' || root.version !== 1) fail('draft schema/version无效')
  if (!Array.isArray(root.items) || root.items.length !== context.itemDemands.length) fail(`items必须与${context.itemDemands.length}项需求一一对应`)
  const items = root.items.map((item, index) => {
    const row = record(item, `items[${index}]`); exactKeys(row, ['demandNumber', 'title', 'description', 'tags', 'equipmentSlotKey'], `items[${index}]`)
    const demandNumber = integer(row.demandNumber, `items[${index}].demandNumber`, 1, context.itemDemands.length)
    const demand = context.itemDemands[demandNumber - 1]!
    const equipmentSlotKey = nullableEnum(row.equipmentSlotKey, EQUIPMENT_SLOTS, `items[${index}].equipmentSlotKey`)
    if ((demand.plannedKind === 'equipment') !== (equipmentSlotKey !== null)) fail(`装备需求与equipmentSlotKey不一致:${demand.sourceDemandKey}`)
    if (demand.fixedEquipmentSlotKey !== null && equipmentSlotKey !== demand.fixedEquipmentSlotKey) fail(`初始装备位不可改写:${demand.sourceDemandKey}`)
    const parsed = {
      demandNumber, title: text(row.title, `items[${index}].title`, 200), description: text(row.description, `items[${index}].description`),
      tags: stringArray(row.tags, `items[${index}].tags`, 8), equipmentSlotKey,
    }
    if (demand.fixedTitle !== null && parsed.title !== demand.fixedTitle) fail(`固定物品标题不可改写:${demand.sourceDemandKey}`)
    if (demand.fixedDescription !== null && parsed.description !== demand.fixedDescription) fail(`固定物品说明不可改写:${demand.sourceDemandKey}`)
    return parsed
  })
  if (items.some((item, index) => item.demandNumber !== index + 1) || new Set(items.map(item => item.demandNumber)).size !== items.length) fail('items必须按需求顺序精确覆盖')
  if (new Set(items.map(item => item.title.toLocaleLowerCase('zh-CN'))).size !== items.length) fail('物品标题不得重复')
  if (!Array.isArray(root.rewards) || root.rewards.length !== context.rewardDemands.length) fail(`rewards必须与${context.rewardDemands.length}项需求一一对应`)
  const rewards = root.rewards.map((item, index) => {
    const row = record(item, `rewards[${index}]`); exactKeys(row, ['demandNumber', 'title', 'description', 'optionalItemDemandNumbers'], `rewards[${index}]`)
    const demandNumber = integer(row.demandNumber, `rewards[${index}].demandNumber`, 1, context.rewardDemands.length)
    const demand = context.rewardDemands[demandNumber - 1]!
    const optionalItemDemandNumbers = integerArray(
      row.optionalItemDemandNumbers,
      `rewards[${index}].optionalItemDemandNumbers`,
      3,
      context.itemDemands.length,
    )
    if (optionalItemDemandNumbers.some(number => context.itemDemands[number - 1]!.demandKind === 'player-initial')) {
      fail(`奖励不得把主角初始物品再次作为可选掉落:${demand.sourceDemandKey}`)
    }
    if (optionalItemDemandNumbers.some(number => demand.mandatoryItemDemandNumbers.includes(number))) {
      fail(`奖励可选物品不得重复强制物品:${demand.sourceDemandKey}`)
    }
    return {
      demandNumber, title: text(row.title, `rewards[${index}].title`, 200), description: text(row.description, `rewards[${index}].description`),
      optionalItemDemandNumbers,
    }
  })
  if (rewards.some((reward, index) => reward.demandNumber !== index + 1) || new Set(rewards.map(reward => reward.demandNumber)).size !== rewards.length) fail('rewards必须按需求顺序精确覆盖')
  if (new Set(rewards.map(reward => reward.title.toLocaleLowerCase('zh-CN'))).size !== rewards.length) fail('奖励标题不得重复')
  return { items, rewards }
}

function itemKey(demand: ItemDemandV1, index: number): string {
  if (demand.fixedItemKey) return demand.fixedItemKey
  if (demand.demandKind === 'region-drop-material') return `item.material.region.${String(index).padStart(3, '0')}`
  return `item.catalog.${String(index).padStart(3, '0')}`
}
function itemStats(kind: ItemKindV1, slot: typeof EQUIPMENT_SLOTS[number] | null, order: number) {
  if (kind !== 'equipment' || slot === null) return {}
  if (slot === 'weapon') return { attack: 1 + Math.ceil(order / 3) }
  if (slot === 'armor') return { defense: 1 + Math.ceil(order / 4), maximumHealth: 2 + order }
  return { criticalChance: Math.min(0.1, 0.01 * Math.ceil(order / 2)), skillResource: 1 }
}
function allocateExact(total: number, weights: number[]): number[] {
  if (!weights.length) return []
  const sum = weights.reduce((value, weight) => value + Math.max(1, weight), 0)
  const raw = weights.map(weight => total * Math.max(1, weight) / sum)
  const result = raw.map(Math.floor)
  let remaining = total - result.reduce((value, amount) => value + amount, 0)
  raw.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach(entry => { if (remaining > 0) { result[entry.index] += 1; remaining -= 1 } })
  return result
}

async function createArtifact(input: { context: TextOpenWorldItemRewardCatalogInputContextV1; draft: CatalogDraftV1; createdAt: number }): Promise<TextOpenWorldItemRewardCatalogV1> {
  const items = input.draft.items.map((draft, index) => {
    const demand = input.context.itemDemands[draft.demandNumber - 1]!
    const kind = demand.plannedKind; const critical = kind === 'quest' || demand.criticality === 'protected'
    return {
      key: itemKey(demand, index + 1), order: index + 1, sourceDemandKey: demand.sourceDemandKey,
      title: draft.title, description: draft.description, tags: draft.tags, kind,
      stackPolicy: kind === 'equipment' || kind === 'quest' ? 'instanced' as const : 'stacked' as const,
      maximumStack: kind === 'equipment' || kind === 'quest' ? null : 99,
      unique: kind === 'quest', consumable: kind === 'consumable', critical,
      droppable: !critical, sellable: !critical,
      baseValue: critical ? 0 : kind === 'equipment' ? 50 + index * 10 : kind === 'consumable' ? 25 : kind === 'material' ? 10 : 15,
      equipmentSlotKey: draft.equipmentSlotKey,
      statModifiers: itemStats(kind, draft.equipmentSlotKey, index + 1),
      fulfilledRequirementKeys: demand.requirementKey ? [demand.requirementKey] : [], sourceRefs: [demand.sourceDemandKey],
      runtimeBinding: { status: 'runtime-unbound' as const, useActionKey: null, equipActionKey: null, unequipActionKey: null,
        equipConditionKeys: [] as [], effectKeys: [] as [], presentationRefs: [] as [] },
    }
  })
  const itemByDemandNumber = new Map(items.map(item => [item.order, item]))
  const mainlineDemands = input.context.rewardDemands.filter(demand => demand.sourceKind === 'quest'
    && input.context.questSkeletons.quests.find(quest => quest.key === demand.sourceSemanticKey)?.type === 'mainline')
  const targetExperience = input.context.progressionCatalogs.levels[4]!.cumulativeExperience
  const mainlineXp = allocateExact(targetExperience, mainlineDemands.map(demand => demand.expectedMinutes))
  let mainlineIndex = 0
  const rewardContracts = input.draft.rewards.map((draft, index) => {
    const demand = input.context.rewardDemands[draft.demandNumber - 1]!
    const quest = demand.sourceKind === 'quest' ? input.context.questSkeletons.quests.find(item => item.key === demand.sourceSemanticKey) : null
    const encounter = demand.sourceKind === 'combat' ? input.context.enemyEncounterCatalog.encounters.find(item => item.key === demand.sourceSemanticKey) : null
    let experience: number
    if (quest?.type === 'mainline') { experience = mainlineXp[mainlineIndex]!; mainlineIndex += 1 }
    else if (demand.sourceKind === 'combat') experience = Math.max(20, (encounter?.recommendedLevel ?? 1) * 30)
    else experience = Math.max(10, demand.expectedMinutes * (quest?.type === 'significant' ? 6 : 4))
    const mandatory = demand.mandatoryItemDemandNumbers
    const optional = draft.optionalItemDemandNumbers
    const itemNumbers = [...mandatory, ...optional].slice(0, 4)
    const budgetClass = quest?.type === 'mainline' || quest?.type === 'significant' || encounter?.intensity === 'boss'
      ? 'major' as const : encounter?.intensity === 'dangerous' ? 'standard' as const : 'minor' as const
    return {
      key: `reward.catalog.${String(index + 1).padStart(3, '0')}`, order: index + 1, sourceDemandKey: demand.sourceDemandKey,
      title: draft.title, description: draft.description, sourceKind: demand.sourceKind, sourceSemanticKey: demand.sourceSemanticKey,
      expectedMinutes: demand.expectedMinutes, budgetClass,
      grants: {
        experience, currency: Math.max(5, demand.expectedMinutes * 2),
        items: itemNumbers.map(number => ({ itemKey: itemByDemandNumber.get(number)!.key, quantity: 1 })),
        skillKeys: demand.mandatorySkillKeys,
      },
      fulfilledRequirementKeys: demand.requirementKeys,
      runtimeBinding: {
        status: 'runtime-unbound' as const, conditionKeys: [] as [], effectKeys: [] as [], dropTableKeys: [] as string[],
        sourceQuestKey: null, sourceEncounterKey: encounter?.key ?? null,
      },
    }
  })
  const regionMaterial = (regionKey: string) => items.find(item => {
    const demand = input.context.itemDemands[item.order - 1]!
    return demand.demandKind === 'region-drop-material' && demand.regionKey === regionKey
  }) ?? fail(`地区缺少掉落材料:${regionKey}`)
  const dropTables = input.context.enemyEncounterCatalog.enemies.map((enemy, index) => {
    const item = regionMaterial(enemy.regionKey)
    return {
      key: `drop.catalog.${String(index + 1).padStart(3, '0')}`, order: index + 1, sourceEnemyKey: enemy.key,
      algorithm: 'weighted-item-then-quantity-v1' as const, rolls: 1 as const,
      entries: [{ itemKey: item.key, minimum: 1, maximum: 2, weight: 100, uniquePolicy: 'reject' as const,
        quantityEffectBindings: [{ quantity: 1, effectKey: null }, { quantity: 2, effectKey: null }] }],
      runtimeBinding: { status: 'effect-unbound' as const, conditionKeys: [] as [] },
    }
  })
  rewardContracts.forEach(reward => {
    if (reward.sourceKind === 'combat') {
      const encounter = input.context.enemyEncounterCatalog.encounters.find(item => item.key === reward.sourceSemanticKey)!
      const enemyKeys = encounter.enemyGroups.map(group => group.enemyKey)
      reward.runtimeBinding.dropTableKeys = dropTables.filter(table => enemyKeys.includes(table.sourceEnemyKey)).map(table => table.key)
    }
  })
  const itemRequirements = input.context.contentRequirementManifest.requirements.filter(requirement =>
    ['item', 'equipment', 'material'].includes(requirement.kind) && requirement.ownerTaskKey === 'p8.catalog.items-rewards').map(requirement => requirement.key)
  const rewardRequirements = input.context.contentRequirementManifest.requirements.filter(requirement =>
    requirement.kind === 'reward' && requirement.ownerTaskKey === 'p8.catalog.items-rewards').map(requirement => requirement.key)
  const questKeys = input.context.questSkeletons.quests.map(quest => quest.key)
  const encounterKeys = input.context.enemyEncounterCatalog.encounters.map(encounter => encounter.key)
  const enemyKeys = input.context.enemyEncounterCatalog.enemies.map(enemy => enemy.key)
  const body: Omit<TextOpenWorldItemRewardCatalogV1, 'itemRewardCatalogHash'> = {
    schema: 'storyforge.text-open-world-item-reward-catalog', version: 1, productType: 'text-open-world', productInstanceKey: input.context.productInstanceKey,
    gameplayRulesetHash: input.context.gameplayRuleset.gameplayRulesetHash, playerBuildHash: input.context.playerBuild.playerBuildHash,
    questSkeletonsHash: input.context.questSkeletons.questSkeletonsHash,
    contentRequirementManifestHash: input.context.contentRequirementManifest.contentRequirementManifestHash,
    progressionCatalogsHash: input.context.progressionCatalogs.progressionCatalogsHash,
    enemyEncounterCatalogHash: input.context.enemyEncounterCatalog.enemyEncounterCatalogHash,
    equipmentSlots: input.context.gameplayRuleset.inventory.equipmentSlots,
    items, rewardContracts, dropTables,
    coverage: {
      requiredPlayerItemKeys: input.context.playerBuild.catalogRequirements.items.map(item => item.key),
      coveredPlayerItemKeys: input.context.playerBuild.catalogRequirements.items.map(item => item.key).filter(key => items.some(item => item.key === key)),
      requiredItemRequirementKeys: itemRequirements,
      coveredItemRequirementKeys: [...new Set(items.flatMap(item => item.fulfilledRequirementKeys))],
      requiredRewardRequirementKeys: rewardRequirements,
      coveredRewardRequirementKeys: [...new Set(rewardContracts.flatMap(reward => reward.fulfilledRequirementKeys))],
      questKeys, rewardedQuestKeys: [...new Set(rewardContracts.filter(reward => reward.sourceKind === 'quest').map(reward => reward.sourceSemanticKey))],
      encounterKeys, rewardedEncounterKeys: [...new Set(rewardContracts.filter(reward => reward.sourceKind === 'combat').map(reward => reward.sourceSemanticKey))],
      enemyKeys, enemyKeysWithDropSource: dropTables.map(table => table.sourceEnemyKey),
      mainlineExperienceTotal: rewardContracts.filter(reward => reward.sourceKind === 'quest'
        && input.context.questSkeletons.quests.find(quest => quest.key === reward.sourceSemanticKey)?.type === 'mainline')
        .reduce((sum, reward) => sum + reward.grants.experience, 0),
      mainlineTargetExperience: targetExperience, uncoveredDemandKeys: [],
    },
    governance: {
      rewardBudgetOwner: 'deterministic-compiler', itemSemanticsOwner: 'model-validated', singleCurrency: true,
      noAffixesEnhancementDurability: true, everyItemHasSourcePlan: true, everyQuestAndEncounterRewarded: true,
      allRuntimeBindingsUnbound: true, itemModuleReady: false,
    },
    basisHash: await hashProductProductionValueV2({
      questSkeletonsHash: input.context.questSkeletons.questSkeletonsHash,
      progressionCatalogsHash: input.context.progressionCatalogs.progressionCatalogsHash,
      enemyEncounterCatalogHash: input.context.enemyEncounterCatalog.enemyEncounterCatalogHash,
      manifestHash: input.context.contentRequirementManifest.contentRequirementManifestHash,
      contextSelectionHash: input.context.contextSelectionHash,
      itemDemandKeys: input.context.itemDemands.map(demand => demand.sourceDemandKey),
      rewardDemandKeys: input.context.rewardDemands.map(demand => demand.sourceDemandKey),
    }),
    createdAt: input.createdAt,
  }
  const same = (left: string[], right: string[]) => canonicalProductProductionJsonV2([...left].sort()) === canonicalProductProductionJsonV2([...right].sort())
  const sourcedItemKeys = new Set([
    ...body.coverage.coveredPlayerItemKeys,
    ...rewardContracts.flatMap(reward => reward.grants.items.map(item => item.itemKey)),
    ...dropTables.flatMap(table => table.entries.map(entry => entry.itemKey)),
  ])
  if (!same(body.coverage.requiredPlayerItemKeys, body.coverage.coveredPlayerItemKeys)
    || !same(body.coverage.requiredItemRequirementKeys, body.coverage.coveredItemRequirementKeys)
    || !same(body.coverage.requiredRewardRequirementKeys, body.coverage.coveredRewardRequirementKeys)
    || !same(body.coverage.questKeys, body.coverage.rewardedQuestKeys)
    || !same(body.coverage.encounterKeys, body.coverage.rewardedEncounterKeys)
    || !same(body.coverage.enemyKeys, body.coverage.enemyKeysWithDropSource)
    || body.coverage.mainlineExperienceTotal !== targetExperience
    || items.some(item => !sourcedItemKeys.has(item.key))) fail('物品来源、需求、任务/遭遇奖励、掉落或主线经验预算未闭合')
  return { ...body, itemRewardCatalogHash: await hashProductProductionValueV2(body) }
}

function draftFromArtifact(artifact: TextOpenWorldItemRewardCatalogV1): unknown {
  return {
    schema: 'storyforge.text-open-world-item-reward-catalog-draft', version: 1,
    items: artifact.items.map(item => ({
      demandNumber: item.order, title: item.title, description: item.description, tags: item.tags, equipmentSlotKey: item.equipmentSlotKey,
    })),
    rewards: artifact.rewardContracts.map(reward => ({
      demandNumber: reward.order, title: reward.title, description: reward.description,
      optionalItemDemandNumbers: reward.grants.items.map(grant => artifact.items.find(item => item.key === grant.itemKey)!.order),
    })),
  }
}

function authorEditableDraftFromArtifact(
  artifact: TextOpenWorldItemRewardCatalogV1,
  context: TextOpenWorldItemRewardCatalogInputContextV1,
): unknown {
  const draft = draftFromArtifact(artifact) as { rewards: Array<{ optionalItemDemandNumbers: number[] }> }
  draft.rewards.forEach((reward, index) => {
    const mandatory = new Set(context.rewardDemands[index]!.mandatoryItemDemandNumbers)
    reward.optionalItemDemandNumbers = reward.optionalItemDemandNumbers.filter(number => !mandatory.has(number))
  })
  return draft
}

export async function validateTextOpenWorldItemRewardCatalogV1(input: {
  artifact: TextOpenWorldItemRewardCatalogV1
  context: TextOpenWorldItemRewardCatalogInputContextV1
}): Promise<TextOpenWorldItemRewardCatalogV1> {
  if (input.artifact.schema !== 'storyforge.text-open-world-item-reward-catalog' || input.artifact.version !== 1
    || !isSha256Hash(input.artifact.itemRewardCatalogHash)) fail('ItemRewardCatalog身份或Hash字段无效')
  integer(input.artifact.createdAt, 'createdAt', 0, Number.MAX_SAFE_INTEGER)
  const context = await parseContext(canonicalProductProductionJsonV2(input.context))
  const draft = parseDraft(authorEditableDraftFromArtifact(input.artifact, context), context)
  const rebuilt = await createArtifact({ context, draft, createdAt: input.artifact.createdAt })
  if (canonicalProductProductionJsonV2(rebuilt) !== canonicalProductProductionJsonV2(input.artifact)) {
    fail('物品来源、奖励预算、稳定键、掉落映射或未绑定运行槽被篡改')
  }
  return structuredClone(input.artifact)
}

export async function projectTextOpenWorldItemRewardCatalogAuthorEditableDraftV1(input: {
  artifact: TextOpenWorldItemRewardCatalogV1
  context: TextOpenWorldItemRewardCatalogInputContextV1 | string
}): Promise<unknown> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const artifact = await validateTextOpenWorldItemRewardCatalogV1({ artifact: input.artifact, context })
  return structuredClone(authorEditableDraftFromArtifact(artifact, context))
}

export async function rebuildTextOpenWorldItemRewardCatalogFromAuthorEditableDraftV1(input: {
  baseArtifact: TextOpenWorldItemRewardCatalogV1
  context: TextOpenWorldItemRewardCatalogInputContextV1 | string
  draft: unknown
}): Promise<TextOpenWorldItemRewardCatalogV1> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const baseArtifact = await validateTextOpenWorldItemRewardCatalogV1({ artifact: input.baseArtifact, context })
  const artifact = await createArtifact({
    context,
    draft: parseDraft(input.draft, context),
    createdAt: baseArtifact.createdAt,
  })
  return validateTextOpenWorldItemRewardCatalogV1({ artifact, context })
}

function systemPrompt(context: TextOpenWorldItemRewardCatalogInputContextV1): string {
  return [
    '你是StoryForge文字开放世界Item与Reward Catalog Designer。你设计物品和奖励的世界化语义；代码负责物品种类/保护、稳定键、装备数值、经验货币预算、强制任务物品/技能奖励、掉落来源和全部运行绑定。',
    `itemDemands共${context.itemDemands.length}项，必须按demandNumber顺序精确覆盖。plannedKind由代码冻结；只有equipment填写equipmentSlotKey，其他必须null。fixedTitle/fixedDescription/fixedEquipmentSlotKey存在时不得改写。`,
    `rewardDemands共${context.rewardDemands.length}项，必须按demandNumber顺序精确覆盖。optionalItemDemandNumbers最多3项，只能选择非player-initial物品需求；mandatoryItemDemandNumbers和mandatorySkillKeys由代码自动加入，不要重复考虑。`,
    '不要输出价格、属性加成、经验、货币、数量、Action、Effect、Condition、QuestKey、DropTable或媒资引用。物品标题和奖励标题各自不得重复。',
    '只输出字段精确的JSON：',
    '{"schema":"storyforge.text-open-world-item-reward-catalog-draft","version":1,"items":[{"demandNumber":1,"title":"...","description":"...","tags":["..."],"equipmentSlotKey":"weapon"}],"rewards":[{"demandNumber":1,"title":"...","description":"...","optionalItemDemandNumbers":[]}]}',
  ].join('\n')
}

async function defaultModelRunner(input: Parameters<TextOpenWorldItemRewardCatalogModelRunnerV1>[0]): Promise<TextOpenWorldItemRewardCatalogModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId, requirementKey: input.requirementKey,
    expectedCapabilityHash: input.expectedCapabilityHash, category: input.category,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: `以下是已登记并验签的物品奖励目录输入：\n<item-reward-catalog-input>\n${input.contextText}\n</item-reward-catalog-input>` }],
    maximumOutputTokens: input.maximumOutputTokens, signal: input.signal, result, responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

export function createTextOpenWorldItemRewardCatalogExecutorV1(options: {
  runModel?: TextOpenWorldItemRewardCatalogModelRunnerV1
  now?: () => number
} = {}): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultModelRunner; const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p8.catalog.items-rewards' || execution.task.skillId !== SKILL_ID || execution.task.executionMode !== 'model') fail('executor只接受P8 ItemReward Catalog任务')
    if (canonicalProductProductionJsonV2(execution.task.outputArtifactKeys) !== canonicalProductProductionJsonV2(['text-open-world.item-reward-catalog'])) fail('ItemReward Catalog输出Artifact集合不精确')
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('ItemReward Catalog需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!; const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey)
    if (!binding) fail('ItemReward Catalog缺少文本capability binding')
    const context = await parseContext(execution.contextText); const prompt = systemPrompt(context); const startedAt = performance.now()
    const response = await runModel({
      projectId: execution.scope.projectId, requirementKey, expectedCapabilityHash: binding.bindingHash,
      category: 'text-open-world.production.item-reward-catalog',
      system: prompt, contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(32_000, execution.task.budgetReservation.outputTokens)), signal: execution.signal,
    })
    if (response.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
    const draft = parseDraft(parseProductionModelJsonObjectV1(response.output, 'text-open-world-item-reward-catalog'), context)
    const artifact = await validateTextOpenWorldItemRewardCatalogV1({
      artifact: await createArtifact({ context, draft, createdAt: integer(now(), 'createdAt', 0, Number.MAX_SAFE_INTEGER) }), context,
    })
    return {
      artifacts: [{
        artifactKey: 'text-open-world.item-reward-catalog', kind: 'text-open-world.item-reward-catalog', payload: artifact,
        quality: { itemRequirementsCovered: true, allItemsSourced: true, allQuestsAndEncountersRewarded: true, mainlineExperienceClosed: true, runtimeBindingsUnbound: true },
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
