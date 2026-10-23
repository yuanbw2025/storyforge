import type {
  TextOpenWorldCraftingEconomyCatalogV1,
  TextOpenWorldItemRewardCatalogV1,
  TextOpenWorldItemSourceKindV1,
  TextOpenWorldItemSourcePlanV1,
} from '../types'
import type { RewardDemandV1, TextOpenWorldItemRewardCatalogInputContextV1 } from './item-reward-catalog-production'

export const ITEM_SOURCE_CONTRACT_V1 = 'explicit-producers-v1' as const
export interface TextOpenWorldItemSourceChoiceV1 {
  choiceNumber: number
  kind: TextOpenWorldItemSourceKindV1
  sourceKey: string
  title: string
  eligibleItemDemandNumbers: number[]
  requiredItemDemandNumbers: number[]
}
const CHOICE_COLUMNS = ['choiceNumber', 'kind', 'sourceKey', 'title', 'eligibleSetNumber', 'requiredSetNumber'] as const
export interface TextOpenWorldItemSourceChoiceTableV1 {
  format: 'item-source-choice-table-v1'
  columns: typeof CHOICE_COLUMNS
  demandNumberSets: number[][]
  rows: Array<[number, TextOpenWorldItemSourceKindV1, string, string, number, number]>
}

/** Lossless wire projection: repeated eligibility lists occur once, while
 * every producer keeps its original number, identity, title and restrictions. */
export function packTextOpenWorldItemSourceChoicesV1(choices: TextOpenWorldItemSourceChoiceV1[]): TextOpenWorldItemSourceChoiceTableV1 {
  const demandNumberSets: number[][] = []
  const setNumbers = new Map<string, number>()
  const intern = (numbers: number[]) => {
    const key = JSON.stringify(numbers)
    const existing = setNumbers.get(key)
    if (existing !== undefined) return existing
    demandNumberSets.push([...numbers])
    setNumbers.set(key, demandNumberSets.length)
    return demandNumberSets.length
  }
  return {
    format: 'item-source-choice-table-v1', columns: CHOICE_COLUMNS, demandNumberSets,
    rows: choices.map(choice => [choice.choiceNumber, choice.kind, choice.sourceKey, choice.title,
      intern(choice.eligibleItemDemandNumbers), intern(choice.requiredItemDemandNumbers)]),
  }
}

export function unpackTextOpenWorldItemSourceChoicesV1(
  value: TextOpenWorldItemSourceChoiceV1[] | TextOpenWorldItemSourceChoiceTableV1 | undefined,
): TextOpenWorldItemSourceChoiceV1[] {
  // Previously frozen expanded contexts retain their exact bytes and hash.
  if (Array.isArray(value)) return value
  if (!value || value.format !== 'item-source-choice-table-v1'
    || Object.keys(value).sort().join(',') !== 'columns,demandNumberSets,format,rows'
    || JSON.stringify(value.columns) !== JSON.stringify(CHOICE_COLUMNS)
    || !Array.isArray(value.demandNumberSets) || !Array.isArray(value.rows)) fail('物品来源表格式无效')
  for (const numbers of value.demandNumberSets) {
    if (!Array.isArray(numbers) || numbers.some(number => !Number.isSafeInteger(number) || number < 1)
      || new Set(numbers).size !== numbers.length) fail('物品来源表需求集合无效')
  }
  const readSet = (number: number) => {
    if (!Number.isSafeInteger(number) || number < 1 || number > value.demandNumberSets.length) fail('物品来源表集合引用越界')
    return [...value.demandNumberSets[number - 1]!]
  }
  return value.rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== 6 || row[0] !== index + 1 || !kinds.includes(row[1])
      || typeof row[2] !== 'string' || !row[2].trim() || typeof row[3] !== 'string' || !row[3].trim()) fail('物品来源表行无效')
    const eligibleItemDemandNumbers = readSet(row[4])
    const requiredItemDemandNumbers = readSet(row[5])
    if (requiredItemDemandNumbers.some(number => !eligibleItemDemandNumbers.includes(number))) fail('固定来源不属于可选集合')
    return { choiceNumber: row[0], kind: row[1], sourceKey: row[2], title: row[3], eligibleItemDemandNumbers, requiredItemDemandNumbers }
  })
}
const REWARD_COLUMNS = ['demandNumber', 'sourceDemandKey', 'sourceKind', 'sourceSemanticKey', 'title', 'semanticBrief',
  'expectedMinutes', 'requirementKeys', 'mandatoryItemDemandNumbers', 'mandatorySkillKeys'] as const
export interface TextOpenWorldRewardDemandTableV1 {
  format: 'reward-demand-table-v1'
  columns: typeof REWARD_COLUMNS
  rows: Array<[number, string, RewardDemandV1['sourceKind'], string, string, string, number, string[], number[], string[]]>
}
export function packTextOpenWorldRewardDemandsV1(demands: RewardDemandV1[]): TextOpenWorldRewardDemandTableV1 {
  return { format: 'reward-demand-table-v1', columns: REWARD_COLUMNS,
    rows: demands.map(demand => [demand.demandNumber, demand.sourceDemandKey, demand.sourceKind, demand.sourceSemanticKey,
      demand.title, demand.semanticBrief, demand.expectedMinutes, [...demand.requirementKeys],
      [...demand.mandatoryItemDemandNumbers], [...demand.mandatorySkillKeys]]) }
}
export function unpackTextOpenWorldRewardDemandsV1(value: RewardDemandV1[] | TextOpenWorldRewardDemandTableV1): RewardDemandV1[] {
  if (Array.isArray(value)) return value
  if (!value || value.format !== 'reward-demand-table-v1' || Object.keys(value).sort().join(',') !== 'columns,format,rows'
    || JSON.stringify(value.columns) !== JSON.stringify(REWARD_COLUMNS) || !Array.isArray(value.rows)) fail('奖励需求表格式无效')
  return value.rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== REWARD_COLUMNS.length || row[0] !== index + 1
      || !['quest', 'combat'].includes(row[2]) || ![row[1], row[3], row[4], row[5]].every(value => typeof value === 'string')
      || !Number.isFinite(row[6]) || ![row[7], row[8], row[9]].every(Array.isArray)) fail('奖励需求表行无效')
    return { demandNumber: row[0], sourceDemandKey: row[1], sourceKind: row[2], sourceSemanticKey: row[3], title: row[4],
      semanticBrief: row[5], expectedMinutes: row[6], requirementKeys: [...row[7]], mandatoryItemDemandNumbers: [...row[8]], mandatorySkillKeys: [...row[9]] }
  })
}
type SourceContext = Pick<TextOpenWorldItemRewardCatalogInputContextV1,
  'itemDemands' | 'questSkeletons' | 'contentRequirementManifest' | 'enemyEncounterCatalog'> & { rewardDemands: RewardDemandV1[] }
const kinds = ['initial', 'reward', 'drop', 'craft', 'vendor', 'acquisition'] as const
function fail(message: string): never { throw new Error(`[text-open-world-item-source] ${message}`) }
const identity = (source: { kind: string; sourceKey: string }) => `${source.kind}:${source.sourceKey}`

/** Producer choices are frozen semantic references, not extra runtime grants.
 * Future owners must resolve their selected obligations before P8F can sign. */
export function buildTextOpenWorldItemSourceChoicesV1(context: SourceContext): TextOpenWorldItemSourceChoiceV1[] {
  const choices: TextOpenWorldItemSourceChoiceV1[] = []
  const add = (kind: TextOpenWorldItemSourceKindV1, sourceKey: string, title: string,
    eligibleItemDemandNumbers: number[], requiredItemDemandNumbers: number[] = []) => {
    choices.push({ choiceNumber: choices.length + 1, kind, sourceKey, title, eligibleItemDemandNumbers, requiredItemDemandNumbers })
  }
  const ordinary = context.itemDemands.filter(item => item.criticality !== 'protected' && item.plannedKind !== 'quest')
  const ordinaryNumbers = ordinary.map(item => item.demandNumber)
  const craftable = ordinary.filter(item => item.fixedItemKey !== 'item.player.starter-weapon').map(item => item.demandNumber)
  for (const item of context.itemDemands.filter(item => item.demandKind === 'player-initial')) {
    add('initial', item.fixedItemKey!, item.fixedTitle!, [item.demandNumber], [item.demandNumber])
  }
  for (const reward of context.rewardDemands) {
    const quest = context.questSkeletons.quests.find(quest => quest.key === reward.sourceSemanticKey)
    const eligible = context.itemDemands.filter(item => {
      if (item.demandKind === 'player-initial') return false
      if (reward.sourceKind === 'combat') return item.criticality !== 'protected'
      const requirement = context.contentRequirementManifest.requirements.find(row => row.key === item.requirementKey)
      const consumers = requirement?.consumerRefs.filter(ref => ref.kind === 'quest-objective').map(ref => (
        context.questSkeletons.objectives.find(objective => objective.key === ref.consumerKey)?.questKey
      )) ?? []
      // A requirement is an input, never proof that its own completion should
      // award that input. Later quest rewards cannot source earlier consumers.
      return consumers.every(key => {
        const consumer = context.questSkeletons.quests.find(row => row.key === key)
        return consumer && quest && quest.order < consumer.order && !quest.lifecyclePlan.repeatable
      })
    }).map(item => item.demandNumber)
    add('reward', reward.sourceDemandKey, reward.title, eligible)
  }
  for (const enemy of context.enemyEncounterCatalog.enemies) {
    const required = context.itemDemands.filter(item => item.demandKind === 'region-drop-material' && item.regionKey === enemy.regionKey)
      .map(item => item.demandNumber)
    add('drop', enemy.key, enemy.title, ordinary.filter(item => item.demandKind !== 'player-initial').map(item => item.demandNumber), required)
  }
  for (const requirement of context.contentRequirementManifest.requirements.filter(row => row.ownerTaskKey === 'p8.catalog.crafting-economy')) {
    if (requirement.kind !== 'recipe' && requirement.kind !== 'vendor') fail(`未知经济来源需求:${requirement.key}`)
    for (let index = 1; index <= requirement.minimumCount; index += 1) {
      add(requirement.kind === 'recipe' ? 'craft' : 'vendor', `${requirement.key}.${String(index).padStart(3, '0')}`,
        `${requirement.title} ${index}`, requirement.kind === 'recipe' ? craftable : ordinaryNumbers)
    }
  }
  const regions = context.enemyEncounterCatalog.coverage.requiredRegionKeys
  for (const region of regions) {
    add('craft', `region-recipe.${region}`, `${region}基础配方`, craftable)
    add('vendor', `region-vendor.${region}`, `${region}基础商店`, ordinaryNumbers)
  }
  for (const objective of context.questSkeletons.objectives) {
    const quest = context.questSkeletons.quests.find(quest => quest.key === objective.questKey)!
    if (quest.type === 'template' || !['collect', 'interact', 'investigate'].includes(objective.playerIntent)) continue
    const eligible = context.itemDemands.filter(item => ['quest', 'misc'].includes(item.plannedKind)
      && context.contentRequirementManifest.requirements.some(requirement => requirement.key === item.requirementKey
        && requirement.consumerRefs.some(ref => ref.kind === 'quest-objective' && ref.consumerKey === objective.key)))
      .map(item => item.demandNumber)
    if (eligible.length) add('acquisition', objective.key, objective.title, eligible)
  }
  if (new Set(choices.map(identity)).size !== choices.length) fail('来源候选身份重复')
  return choices
}

export function compileTextOpenWorldItemSourcePlansV1(input: {
  items: TextOpenWorldItemRewardCatalogV1['items']
  choices: TextOpenWorldItemSourceChoiceV1[]
  selections: number[][]
}): TextOpenWorldItemSourcePlanV1[] {
  const plans = input.items.map((item, index) => {
    const required = input.choices.filter(choice => choice.requiredItemDemandNumbers.includes(item.order)).map(choice => choice.choiceNumber)
    const selected = input.selections[index]!
    if (!Array.isArray(selected) || selected.length > 16 || new Set(selected).size !== selected.length) fail(`物品来源选择必须唯一且最多16项:${item.key}`)
    const choices = [...required, ...selected].map(number => {
      const choice = input.choices[number - 1]
      if (!Number.isSafeInteger(number) || !choice || !choice.eligibleItemDemandNumbers.includes(item.order)) fail(`物品来源越界或不属于该物品:${item.key}`)
      return choice
    })
    if (!choices.length || new Set(choices.map(identity)).size !== choices.length) fail(`物品缺来源或重复指定固定来源:${item.key}`)
    return { itemKey: item.key, sources: choices.map(({ kind, sourceKey }) => ({ kind, sourceKey })) }
  })
  for (const choice of input.choices) {
    const count = plans.filter(plan => plan.sources.some(source => identity(source) === identity(choice))).length
    if (choice.kind === 'craft' && count !== 1) fail(`每份配方必须明确选择一个产物:${choice.sourceKey}`)
    if (choice.kind === 'vendor' && (count < 1 || count > 12)) fail(`每家商店必须明确选择1到12种商品:${choice.sourceKey}`)
    if (choice.kind === 'reward' && count > 4) fail(`奖励最多4种物品，不能静默截断:${choice.sourceKey}`)
    if (choice.kind === 'acquisition' && count > 8) fail(`领取目标最多8种物品:${choice.sourceKey}`)
  }
  return plans
}

export function hasTextOpenWorldExplicitItemSourcesV1(catalog: TextOpenWorldItemRewardCatalogV1): boolean {
  if (catalog.itemSourceContract === undefined && catalog.itemSourcePlans === undefined) return false
  if (catalog.itemSourceContract !== ITEM_SOURCE_CONTRACT_V1 || !Array.isArray(catalog.itemSourcePlans)
    || catalog.itemSourcePlans.length !== catalog.items.length) fail('物品来源合同缺失或版本不匹配')
  catalog.itemSourcePlans.forEach((plan, index) => {
    if (!plan || Object.keys(plan).sort().join(',') !== 'itemKey,sources' || plan.itemKey !== catalog.items[index]!.key
      || !Array.isArray(plan.sources) || !plan.sources.length || plan.sources.length > 116) fail('物品来源计划必须按目录精确覆盖')
    for (const source of plan.sources) {
      if (!source || Object.keys(source).sort().join(',') !== 'kind,sourceKey' || !kinds.includes(source.kind)
        || typeof source.sourceKey !== 'string' || !source.sourceKey.trim()) fail(`来源身份无效:${plan.itemKey}`)
      const item = catalog.items[index]!
      if (item.critical && ['craft', 'vendor', 'drop'].includes(source.kind)) fail(`关键物品不得由制作、商店或掉落产生:${item.key}`)
      if (source.kind === 'acquisition' && !['quest', 'misc'].includes(item.kind)) fail(`领取来源不能产生装备、材料、消耗品:${item.key}`)
    }
    if (new Set(plan.sources.map(identity)).size !== plan.sources.length) fail(`来源重复:${plan.itemKey}`)
  })
  return true
}

export function itemHasPlannedSourceV1(catalog: TextOpenWorldItemRewardCatalogV1, itemKey: string,
  kind: TextOpenWorldItemSourceKindV1, sourceKey?: string): boolean {
  return catalog.itemSourcePlans?.find(plan => plan.itemKey === itemKey)?.sources.some(source => (
    source.kind === kind && (sourceKey === undefined || source.sourceKey === sourceKey)
  )) ?? false
}

/** Check concrete producers in their owning phase. An acquisition promise is
 * not a recipe ingredient source; it is resolved only against real P8F picks. */
export function assertTextOpenWorldItemSourceClosureV1(input: {
  catalog: TextOpenWorldItemRewardCatalogV1
  economy?: TextOpenWorldCraftingEconomyCatalogV1
  acquisitions?: Array<{ itemKey: string; objectiveKey: string }>
}): void {
  const { catalog, economy, acquisitions } = input
  if (!hasTextOpenWorldExplicitItemSourcesV1(catalog)) return
  const checkedKinds: TextOpenWorldItemSourceKindV1[] = ['initial', 'reward', 'drop', ...(economy ? ['craft', 'vendor'] as const : []),
    ...(acquisitions ? ['acquisition'] as const : [])]
  const actual: Array<{ itemKey: string; kind: TextOpenWorldItemSourceKindV1; sourceKey: string }> = [
    ...catalog.coverage.coveredPlayerItemKeys.map(itemKey => ({ itemKey, kind: 'initial' as const, sourceKey: itemKey })),
    ...catalog.rewardContracts.flatMap(reward => reward.grants.items.map(grant => ({ itemKey: grant.itemKey, kind: 'reward' as const, sourceKey: reward.sourceDemandKey }))),
    ...catalog.dropTables.flatMap(drop => drop.entries.map(entry => ({ itemKey: entry.itemKey, kind: 'drop' as const, sourceKey: drop.sourceEnemyKey }))),
    ...(economy?.recipes.flatMap(recipe => recipe.outputs.map(output => ({ itemKey: output.itemKey, kind: 'craft' as const, sourceKey: recipe.sourceDemandKey }))) ?? []),
    ...(economy?.vendors.flatMap(vendor => vendor.inventoryEntries.map(entry => ({ itemKey: entry.itemKey, kind: 'vendor' as const, sourceKey: vendor.sourceDemandKey }))) ?? []),
    ...(acquisitions?.map(pick => ({ itemKey: pick.itemKey, kind: 'acquisition' as const, sourceKey: pick.objectiveKey })) ?? []),
  ]
  const expected = catalog.itemSourcePlans!.flatMap(plan => plan.sources.filter(source => checkedKinds.includes(source.kind))
    .map(source => ({ itemKey: plan.itemKey, ...source })))
  const keys = (rows: typeof actual) => rows.map(row => `${row.itemKey}:${identity(row)}`).sort()
  if (new Set(keys(actual)).size !== actual.length || JSON.stringify(keys(actual)) !== JSON.stringify(keys(expected))) {
    fail('明确物品来源与实际奖励、掉落、配方、库存或领取不闭合')
  }
}
