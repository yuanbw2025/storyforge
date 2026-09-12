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
  TextOpenWorldPlayerBuildV1,
  TextOpenWorldProgressionCatalogsV1,
  TextOpenWorldQuestSkeletonsV1,
  TextOpenWorldRegionNarrativePacksV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { validateTextOpenWorldGameplayRulesetSkeletonV1 } from './gameplay-ruleset'

const SKILL_ID = 'text-open-world.production.encounter-catalog.v1'
const MAX_CONTEXT_CHARS = 280_000
const ARCHETYPES = ['balanced', 'brute', 'swift', 'armored'] as const
const INTENSITIES = ['ordinary', 'dangerous', 'boss'] as const

interface EncounterDemandV1 {
  demandNumber: number
  sourceDemandKey: string
  demandKind: 'enemy-requirement' | 'encounter-requirement' | 'region-baseline'
  requirementKey: string | null
  title: string
  description: string
  requestedTraits: string[]
  criticality: 'ordinary' | 'important' | 'protected'
  regionKey: string
  candidateLocationKeys: string[]
  questObjectiveKeys: string[]
}

export interface TextOpenWorldEncounterCatalogInputContextV1 {
  schema: 'storyforge.text-open-world-encounter-catalog-input'
  version: 1
  productInstanceKey: string
  gameplayRuleset: TextOpenWorldGameplayRulesetSkeletonV1
  playerBuild: TextOpenWorldPlayerBuildV1
  regionNarrativePacks: TextOpenWorldRegionNarrativePacksV1
  questSkeletons: TextOpenWorldQuestSkeletonsV1
  contentRequirementManifest: TextOpenWorldContentRequirementManifestV1
  progressionCatalogs: TextOpenWorldProgressionCatalogsV1
  encounterDemands: EncounterDemandV1[]
  contextSelectionHash: string
}

export interface TextOpenWorldEncounterCatalogModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldEncounterCatalogModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  expectedCapabilityHash: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldEncounterCatalogModelExecutionV1>

interface EncounterDraftV1 {
  encounters: Array<{
    demandNumber: number
    enemyTitle: string
    enemyDescription: string
    enemyTags: string[]
    enemyArchetype: typeof ARCHETYPES[number]
    encounterTitle: string
    encounterDescription: string
    locationNumber: number
    recommendedLevel: number
    intensity: typeof INTENSITIES[number]
    enemyCount: number
    openingText: string
    victoryText: string
    defeatText: string
  }>
}

function fail(message: string): never { throw new Error(`[text-open-world-encounter-catalog] ${message}`) }
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
function strings(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) fail(`${label}必须是1到${maximum}项数组`)
  const result = value.map((item, index) => text(item, `${label}[${index}]`, 300))
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

function questForObjective(context: Pick<TextOpenWorldEncounterCatalogInputContextV1, 'questSkeletons'>, objectiveKey: string) {
  const objective = context.questSkeletons.objectives.find(item => item.key === objectiveKey) ?? fail(`Requirement引用未知Objective:${objectiveKey}`)
  return context.questSkeletons.quests.find(item => item.key === objective.questKey) ?? fail(`Objective缺少Quest:${objectiveKey}`)
}

function buildEncounterDemands(input: {
  regionPacks: TextOpenWorldRegionNarrativePacksV1
  quests: TextOpenWorldQuestSkeletonsV1
  manifest: TextOpenWorldContentRequirementManifestV1
}): EncounterDemandV1[] {
  const demands: EncounterDemandV1[] = []
  const initialPack = input.regionPacks.packs[0] ?? fail('RegionNarrativePacks为空')
  const requirements = input.manifest.requirements.filter(requirement => requirement.ownerTaskKey === 'p8.catalog.encounters')
  requirements.forEach(requirement => {
    if ((requirement.kind !== 'enemy' && requirement.kind !== 'encounter') || requirement.sourceReservationKey !== null
      || requirement.binding.status !== 'catalog-unbound' || requirement.binding.definitionKeys.length) fail(`遭遇目录收到非法需求:${requirement.key}`)
    const objectiveKeys = requirement.consumerRefs.filter(ref => ref.kind === 'quest-objective').map(ref => ref.consumerKey)
    if (!objectiveKeys.length) fail(`敌人/遭遇需求必须至少服务一个Quest Objective:${requirement.key}`)
    const relatedQuests = objectiveKeys.map(objectiveKey => questForObjective({ questSkeletons: input.quests }, objectiveKey))
    const regionKey = relatedQuests[0]!.regionKeys[0] ?? initialPack.regionKey
    const regionPack = input.regionPacks.packs.find(pack => pack.regionKey === regionKey) ?? initialPack
    const questLocations = [...new Set(relatedQuests.flatMap(quest => quest.locationKeys))]
      .filter(locationKey => regionPack.locationPlans.some(plan => plan.locationKey === locationKey))
    const candidateLocationKeys = questLocations.length ? questLocations : regionPack.locationPlans.map(plan => plan.locationKey)
    for (let index = 0; index < requirement.minimumCount; index += 1) demands.push({
      demandNumber: demands.length + 1,
      sourceDemandKey: `${requirement.key}.${String(index + 1).padStart(3, '0')}`,
      demandKind: requirement.kind === 'enemy' ? 'enemy-requirement' : 'encounter-requirement',
      requirementKey: requirement.key,
      title: requirement.minimumCount === 1 ? requirement.title : `${requirement.title} ${index + 1}`,
      description: requirement.description,
      requestedTraits: requirement.requestedTraits,
      criticality: requirement.criticality,
      regionKey: regionPack.regionKey,
      candidateLocationKeys,
      questObjectiveKeys: objectiveKeys,
    })
  })
  input.regionPacks.packs.forEach(pack => demands.push({
    demandNumber: demands.length + 1,
    sourceDemandKey: `region-baseline.${pack.regionKey}`,
    demandKind: 'region-baseline',
    requirementKey: null,
    title: `${pack.identity.title}基础遭遇`,
    description: `${pack.identity.localConflict}；遭遇用于地区探索和成长资源循环，不触发关键故事。`,
    requestedTraits: [pack.identity.fantasy, ...pack.tensions.slice(0, 2).map(tension => tension.pressureAxis)],
    criticality: 'ordinary',
    regionKey: pack.regionKey,
    candidateLocationKeys: pack.locationPlans
      .filter(plan => plan.requiredFunctions.includes('combat') || plan.contentRisk !== 'safe')
      .map(plan => plan.locationKey).concat(pack.locationPlans.map(plan => plan.locationKey)).filter((key, index, all) => all.indexOf(key) === index),
    questObjectiveKeys: [],
  }))
  if (demands.length > 80) fail('遭遇需求超过单Build首版上限80')
  return demands
}

async function validateUpstream(context: Omit<TextOpenWorldEncounterCatalogInputContextV1, 'contextSelectionHash'>): Promise<void> {
  const { gameplayRuleset, playerBuild, regionNarrativePacks, questSkeletons, contentRequirementManifest, progressionCatalogs } = context
  await validateTextOpenWorldGameplayRulesetSkeletonV1({ artifact: gameplayRuleset })
  for (const [value, hashKey, label] of [
    [playerBuild, 'playerBuildHash', 'PlayerBuild'],
    [regionNarrativePacks, 'regionNarrativePacksHash', 'RegionNarrativePacks'],
    [questSkeletons, 'questSkeletonsHash', 'QuestSkeletons'],
    [contentRequirementManifest, 'contentRequirementManifestHash', 'ContentRequirementManifest'],
    [progressionCatalogs, 'progressionCatalogsHash', 'ProgressionCatalogs'],
  ] as const) await assertOwnHash(value as unknown as Record<string, unknown>, hashKey, label)
  if (gameplayRuleset.productInstanceKey !== context.productInstanceKey || playerBuild.productInstanceKey !== context.productInstanceKey
    || regionNarrativePacks.productInstanceKey !== context.productInstanceKey || questSkeletons.productInstanceKey !== context.productInstanceKey
    || contentRequirementManifest.productInstanceKey !== context.productInstanceKey || progressionCatalogs.productInstanceKey !== context.productInstanceKey
    || contentRequirementManifest.questSkeletonsHash !== questSkeletons.questSkeletonsHash
    || progressionCatalogs.questSkeletonsHash !== questSkeletons.questSkeletonsHash
    || progressionCatalogs.contentRequirementManifestHash !== contentRequirementManifest.contentRequirementManifestHash
    || progressionCatalogs.governance.allRuntimeBindingsUnbound !== true) fail('Encounter Catalog上游身份、引用或未绑定边界无效')
  const expected = buildEncounterDemands({ regionPacks: regionNarrativePacks, quests: questSkeletons, manifest: contentRequirementManifest })
  if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(context.encounterDemands)) fail('encounterDemands不是上游确定性投影')
  const combatObjectives = questSkeletons.objectives.filter(objective => objective.playerIntent === 'combat')
  combatObjectives.forEach(objective => {
    if (!contentRequirementManifest.requirements.some(requirement =>
      (requirement.kind === 'enemy' || requirement.kind === 'encounter')
      && requirement.consumerRefs.some(ref => ref.kind === 'quest-objective' && ref.consumerKey === objective.key))) {
      fail(`战斗Objective缺少敌人/遭遇需求:${objective.key}`)
    }
  })
}

async function loadContext(input: { scope: WorkspaceScope; productionId: number; buildId: number }): Promise<TextOpenWorldEncounterCatalogInputContextV1> {
  const [production, build, rows] = await Promise.all([
    db.productProductions.get(input.productionId), db.productBuilds.get(input.buildId),
    readAcceptedBuildArtifacts({ scope: input.scope, buildId: input.buildId }),
  ])
  if (!production || production.productType !== 'text-open-world'
    || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) fail('Production不存在、跨Work或类型错误')
  if (!build || build.productionId !== production.id
    || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) fail('Build不属于当前Production/Work')
  const keys = [
    'text-open-world.gameplay-ruleset-skeleton', 'text-open-world.player-build', 'text-open-world.region-narrative-packs',
    'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest', 'text-open-world.progression-catalogs',
  ] as const
  const rowsByKey = Object.fromEntries(keys.map(key => [key, unique(rows, key)])) as Record<typeof keys[number], ProductBuildArtifactRecordV1>
  const gameplayRuleset = artifact<TextOpenWorldGameplayRulesetSkeletonV1>(rowsByKey[keys[0]], keys[0])
  const playerBuild = artifact<TextOpenWorldPlayerBuildV1>(rowsByKey[keys[1]], keys[1])
  const regionNarrativePacks = artifact<TextOpenWorldRegionNarrativePacksV1>(rowsByKey[keys[2]], keys[2])
  const questSkeletons = artifact<TextOpenWorldQuestSkeletonsV1>(rowsByKey[keys[3]], keys[3])
  const contentRequirementManifest = artifact<TextOpenWorldContentRequirementManifestV1>(rowsByKey[keys[4]], keys[4])
  const progressionCatalogs = artifact<TextOpenWorldProgressionCatalogsV1>(rowsByKey[keys[5]], keys[5])
  const payloads = [gameplayRuleset, playerBuild, regionNarrativePacks, questSkeletons, contentRequirementManifest, progressionCatalogs]
  for (let index = 0; index < keys.length; index += 1) {
    if (await hashProductProductionValueV2(payloads[index]) !== rowsByKey[keys[index]].contentHash) fail(`Artifact行Hash不匹配:${keys[index]}`)
  }
  const body: Omit<TextOpenWorldEncounterCatalogInputContextV1, 'contextSelectionHash'> = {
    schema: 'storyforge.text-open-world-encounter-catalog-input', version: 1, productInstanceKey: production.productionKey,
    gameplayRuleset, playerBuild, regionNarrativePacks, questSkeletons, contentRequirementManifest, progressionCatalogs,
    encounterDemands: buildEncounterDemands({ regionPacks: regionNarrativePacks, quests: questSkeletons, manifest: contentRequirementManifest }),
  }
  await validateUpstream(body)
  const context = { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Encounter Catalog Context超过硬上限')
  return context
}

export async function readTextOpenWorldEncounterCatalogInputContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !Number.isSafeInteger(input.productProductionId) || !Number.isSafeInteger(input.productBuildId)) fail('Context读取缺少scope/production/build selector')
  return canonicalProductProductionJsonV2(await loadContext({ scope: input.scope, productionId: input.productProductionId!, buildId: input.productBuildId! }))
}

async function parseContext(value: string): Promise<TextOpenWorldEncounterCatalogInputContextV1> {
  let context: TextOpenWorldEncounterCatalogInputContextV1
  try { context = JSON.parse(value) as TextOpenWorldEncounterCatalogInputContextV1 } catch { return fail('Context JSON损坏') }
  if (context.schema !== 'storyforge.text-open-world-encounter-catalog-input' || context.version !== 1) fail('Context身份无效')
  const { contextSelectionHash, ...body } = context
  await validateUpstream(body)
  if (!isSha256Hash(contextSelectionHash) || await hashProductProductionValueV2(body) !== contextSelectionHash) fail('Context选择Hash不匹配')
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Context超过硬上限')
  return context
}

function parseDraft(value: unknown, context: TextOpenWorldEncounterCatalogInputContextV1): EncounterDraftV1 {
  const root = record(value, 'draft'); exactKeys(root, ['schema', 'version', 'encounters'], 'draft')
  if (root.schema !== 'storyforge.text-open-world-encounter-catalog-draft' || root.version !== 1) fail('draft schema/version无效')
  if (!Array.isArray(root.encounters) || root.encounters.length !== context.encounterDemands.length) {
    fail(`encounters必须与${context.encounterDemands.length}项需求一一对应`)
  }
  const encounters = root.encounters.map((item, index) => {
    const row = record(item, `encounters[${index}]`)
    exactKeys(row, [
      'demandNumber', 'enemyTitle', 'enemyDescription', 'enemyTags', 'enemyArchetype', 'encounterTitle',
      'encounterDescription', 'locationNumber', 'recommendedLevel', 'intensity', 'enemyCount', 'openingText', 'victoryText', 'defeatText',
    ], `encounters[${index}]`)
    const demandNumber = integer(row.demandNumber, `encounters[${index}].demandNumber`, 1, context.encounterDemands.length)
    const demand = context.encounterDemands[demandNumber - 1]!
    return {
      demandNumber,
      enemyTitle: text(row.enemyTitle, `encounters[${index}].enemyTitle`, 200),
      enemyDescription: text(row.enemyDescription, `encounters[${index}].enemyDescription`),
      enemyTags: strings(row.enemyTags, `encounters[${index}].enemyTags`, 8),
      enemyArchetype: enumValue(row.enemyArchetype, ARCHETYPES, `encounters[${index}].enemyArchetype`),
      encounterTitle: text(row.encounterTitle, `encounters[${index}].encounterTitle`, 200),
      encounterDescription: text(row.encounterDescription, `encounters[${index}].encounterDescription`),
      locationNumber: integer(row.locationNumber, `encounters[${index}].locationNumber`, 1, demand.candidateLocationKeys.length),
      recommendedLevel: integer(
        row.recommendedLevel,
        `encounters[${index}].recommendedLevel`,
        context.gameplayRuleset.progression.acceptanceLevelRange.minimum,
        context.gameplayRuleset.progression.acceptanceLevelRange.maximum,
      ),
      intensity: enumValue(row.intensity, INTENSITIES, `encounters[${index}].intensity`),
      enemyCount: integer(row.enemyCount, `encounters[${index}].enemyCount`, 1, 5),
      openingText: text(row.openingText, `encounters[${index}].openingText`),
      victoryText: text(row.victoryText, `encounters[${index}].victoryText`),
      defeatText: text(row.defeatText, `encounters[${index}].defeatText`),
    }
  })
  const numbers = encounters.map(encounter => encounter.demandNumber)
  if (numbers.some((number, index) => number !== index + 1) || new Set(numbers).size !== context.encounterDemands.length) fail('encounters必须按需求顺序精确覆盖')
  if (new Set(encounters.map(encounter => encounter.enemyTitle.toLocaleLowerCase('zh-CN'))).size !== encounters.length) fail('敌人标题不得重复')
  if (new Set(encounters.map(encounter => encounter.encounterTitle.toLocaleLowerCase('zh-CN'))).size !== encounters.length) fail('遭遇标题不得重复')
  return { encounters }
}

function enemyStats(level: number, archetype: typeof ARCHETYPES[number]) {
  const base = { maximumHealth: 14 + level * 6, attack: 2 + level * 2, defense: level, criticalChance: 0.04 + Math.min(0.16, level * 0.005), initiative: 2 + level }
  if (archetype === 'brute') return { ...base, maximumHealth: base.maximumHealth + level * 4, attack: base.attack + level, initiative: Math.max(1, base.initiative - 2) }
  if (archetype === 'swift') return { ...base, maximumHealth: Math.max(1, base.maximumHealth - level * 2), criticalChance: Math.min(0.35, base.criticalChance + 0.05), initiative: base.initiative + level }
  if (archetype === 'armored') return { ...base, maximumHealth: base.maximumHealth + level * 2, defense: base.defense + level * 2, attack: Math.max(1, base.attack - 1) }
  return base
}

async function createArtifact(input: { context: TextOpenWorldEncounterCatalogInputContextV1; draft: EncounterDraftV1; createdAt: number }): Promise<TextOpenWorldEnemyEncounterCatalogV1> {
  const basicSkill = input.context.progressionCatalogs.skills.find(skill => skill.key === 'skill.player.basic-attack') ?? fail('ProgressionCatalog缺少基础攻击')
  if (!basicSkill.combatResolutionPlan.required || basicSkill.combatResolutionPlan.powerNumerator === null
    || basicSkill.combatResolutionPlan.powerDenominator === null || basicSkill.combatResolutionPlan.flatDamage === null) fail('基础攻击缺少战斗公式')
  const enemies: TextOpenWorldEnemyEncounterCatalogV1['enemies'] = []
  const encounters: TextOpenWorldEnemyEncounterCatalogV1['encounters'] = []
  const strategies: TextOpenWorldEnemyEncounterCatalogV1['strategyProfiles'] = []
  input.draft.encounters.forEach((draft, index) => {
    const demand = input.context.encounterDemands[draft.demandNumber - 1]!
    const number = String(index + 1).padStart(3, '0')
    const enemyKey = `enemy.catalog.${number}`
    const encounterKey = `encounter.catalog.${number}`
    const strategyKey = `strategy.enemy.${number}`
    const stats = enemyStats(draft.recommendedLevel, draft.enemyArchetype)
    const fulfilled = demand.requirementKey === null ? [] : [demand.requirementKey]
    strategies.push({ key: strategyKey, title: `${draft.enemyTitle}行动策略`, selection: 'ordered-skill-priority', prioritySkillKeys: [basicSkill.key], fallbackSkillKey: basicSkill.key })
    enemies.push({
      key: enemyKey, order: index + 1, familyKey: `enemy-family.catalog.${number}`, sourceDemandKey: demand.sourceDemandKey,
      title: draft.enemyTitle, description: draft.enemyDescription, tags: draft.enemyTags,
      regionKey: demand.regionKey, homeLocationKey: demand.candidateLocationKeys[draft.locationNumber - 1]!, level: draft.recommendedLevel,
      ...stats, skillKeys: [basicSkill.key], strategyProfileKey: strategyKey,
      fulfilledRequirementKeys: demand.demandKind === 'enemy-requirement' ? fulfilled : [],
      sourceRefs: [demand.sourceDemandKey],
      runtimeBinding: { status: 'runtime-partial', dropTableKey: null, dropRequirementKey: `drop-requirement.${enemyKey}`, presentationRefs: [] },
    })
    encounters.push({
      key: encounterKey, order: index + 1, sourceDemandKey: demand.sourceDemandKey,
      title: draft.encounterTitle, description: draft.encounterDescription, regionKey: demand.regionKey,
      locationKey: demand.candidateLocationKeys[draft.locationNumber - 1]!, questObjectiveKeys: demand.questObjectiveKeys,
      enemyGroups: [{ key: `group.${encounterKey}.001`, enemyKey, count: draft.enemyCount, order: 1 }],
      recommendedLevel: draft.recommendedLevel,
      levelBand: { minimum: Math.max(1, draft.recommendedLevel - 1), maximum: Math.min(20, draft.recommendedLevel + 1) },
      difficultyProfileKey: 'standard', intensity: draft.intensity,
      escapePolicy: { allowed: true, failureConsumesTurn: true },
      defeatPolicy: { kind: 'retry-or-respawn', preservesWorldProgress: true },
      openingText: draft.openingText, victoryText: draft.victoryText, defeatText: draft.defeatText,
      fulfilledRequirementKeys: demand.demandKind === 'encounter-requirement' ? fulfilled : [], sourceRefs: [demand.sourceDemandKey],
      runtimeBinding: { status: 'runtime-unbound', questKeys: [], rewardContractKey: null, rewardRequirementKey: `reward-requirement.${encounterKey}`, presentationRefs: [] },
    })
  })
  const enemyRequirements = input.context.contentRequirementManifest.requirements.filter(requirement => requirement.kind === 'enemy' && requirement.ownerTaskKey === 'p8.catalog.encounters').map(requirement => requirement.key)
  const encounterRequirements = input.context.contentRequirementManifest.requirements.filter(requirement => requirement.kind === 'encounter' && requirement.ownerTaskKey === 'p8.catalog.encounters').map(requirement => requirement.key)
  const combatObjectiveKeys = input.context.questSkeletons.objectives.filter(objective => objective.playerIntent === 'combat').map(objective => objective.key)
  const coveredCombatObjectiveKeys = [...new Set(input.context.encounterDemands.flatMap(demand => demand.questObjectiveKeys))].sort()
  const body: Omit<TextOpenWorldEnemyEncounterCatalogV1, 'enemyEncounterCatalogHash'> = {
    schema: 'storyforge.text-open-world-enemy-encounter-catalog', version: 1, productType: 'text-open-world', productInstanceKey: input.context.productInstanceKey,
    gameplayRulesetHash: input.context.gameplayRuleset.gameplayRulesetHash, playerBuildHash: input.context.playerBuild.playerBuildHash,
    regionNarrativePacksHash: input.context.regionNarrativePacks.regionNarrativePacksHash, questSkeletonsHash: input.context.questSkeletons.questSkeletonsHash,
    contentRequirementManifestHash: input.context.contentRequirementManifest.contentRequirementManifestHash,
    progressionCatalogsHash: input.context.progressionCatalogs.progressionCatalogsHash,
    rules: input.context.gameplayRuleset.combat,
    playerSkillResolutions: input.context.progressionCatalogs.skills.filter(skill => skill.combatResolutionPlan.required).map(skill => ({
      skillKey: skill.key, powerNumerator: skill.combatResolutionPlan.powerNumerator!,
      powerDenominator: skill.combatResolutionPlan.powerDenominator!, flatDamage: skill.combatResolutionPlan.flatDamage!,
    })),
    strategyProfiles: strategies, enemies, encounters,
    coverage: {
      requiredEnemyRequirementKeys: enemyRequirements,
      coveredEnemyRequirementKeys: [...new Set(enemies.flatMap(enemy => enemy.fulfilledRequirementKeys))],
      requiredEncounterRequirementKeys: encounterRequirements,
      coveredEncounterRequirementKeys: [...new Set(encounters.flatMap(encounter => encounter.fulfilledRequirementKeys))],
      combatObjectiveKeys, coveredCombatObjectiveKeys,
      requiredRegionKeys: input.context.regionNarrativePacks.packs.map(pack => pack.regionKey),
      coveredRegionKeys: [...new Set(encounters.map(encounter => encounter.regionKey))],
      uncoveredDemandKeys: [],
    },
    governance: {
      statOwner: 'deterministic-compiler', semanticOwner: 'model-validated', standardDifficultyOnly: true,
      friendlyNpcCombatants: false, elementsDisabled: true, everyCombatObjectiveCovered: true,
      rewardsAndDropsDeferred: true, encounterModuleReady: false,
    },
    basisHash: await hashProductProductionValueV2({
      gameplayRulesetHash: input.context.gameplayRuleset.gameplayRulesetHash,
      progressionCatalogsHash: input.context.progressionCatalogs.progressionCatalogsHash,
      questSkeletonsHash: input.context.questSkeletons.questSkeletonsHash,
      manifestHash: input.context.contentRequirementManifest.contentRequirementManifestHash,
      contextSelectionHash: input.context.contextSelectionHash,
      demandKeys: input.context.encounterDemands.map(demand => demand.sourceDemandKey),
    }),
    createdAt: input.createdAt,
  }
  const same = (left: string[], right: string[]) => canonicalProductProductionJsonV2([...left].sort()) === canonicalProductProductionJsonV2([...right].sort())
  if (!same(body.coverage.requiredEnemyRequirementKeys, body.coverage.coveredEnemyRequirementKeys)
    || !same(body.coverage.requiredEncounterRequirementKeys, body.coverage.coveredEncounterRequirementKeys)
    || !same(body.coverage.combatObjectiveKeys, body.coverage.coveredCombatObjectiveKeys)
    || !same(body.coverage.requiredRegionKeys, body.coverage.coveredRegionKeys)) fail('敌人/遭遇/战斗Objective/地区覆盖不完整')
  return { ...body, enemyEncounterCatalogHash: await hashProductProductionValueV2(body) }
}

function draftFromArtifact(artifact: TextOpenWorldEnemyEncounterCatalogV1, context: TextOpenWorldEncounterCatalogInputContextV1): unknown {
  return { schema: 'storyforge.text-open-world-encounter-catalog-draft', version: 1, encounters: artifact.encounters.map((encounter, index) => {
    const enemy = artifact.enemies[index] ?? fail(`Encounter缺少同序Enemy:${encounter.key}`)
    const demand = context.encounterDemands[index]!
    const base = enemyStats(enemy.level, 'balanced')
    const archetype = (['balanced', 'brute', 'swift', 'armored'] as const).find(candidate =>
      canonicalProductProductionJsonV2(enemyStats(enemy.level, candidate)) === canonicalProductProductionJsonV2({
        maximumHealth: enemy.maximumHealth, attack: enemy.attack, defense: enemy.defense,
        criticalChance: enemy.criticalChance, initiative: enemy.initiative,
      })) ?? fail(`Enemy数值不属于确定性archetype:${enemy.key}:${canonicalProductProductionJsonV2(base)}`)
    return {
      demandNumber: index + 1, enemyTitle: enemy.title, enemyDescription: enemy.description, enemyTags: enemy.tags,
      enemyArchetype: archetype, encounterTitle: encounter.title, encounterDescription: encounter.description,
      locationNumber: demand.candidateLocationKeys.indexOf(encounter.locationKey) + 1,
      recommendedLevel: encounter.recommendedLevel, intensity: encounter.intensity,
      enemyCount: encounter.enemyGroups[0]?.count ?? 0,
      openingText: encounter.openingText, victoryText: encounter.victoryText, defeatText: encounter.defeatText,
    }
  }) }
}

export async function validateTextOpenWorldEnemyEncounterCatalogV1(input: {
  artifact: TextOpenWorldEnemyEncounterCatalogV1
  context: TextOpenWorldEncounterCatalogInputContextV1
}): Promise<TextOpenWorldEnemyEncounterCatalogV1> {
  if (input.artifact.schema !== 'storyforge.text-open-world-enemy-encounter-catalog' || input.artifact.version !== 1
    || !isSha256Hash(input.artifact.enemyEncounterCatalogHash)) fail('EnemyEncounterCatalog身份或Hash字段无效')
  integer(input.artifact.createdAt, 'createdAt', 0, Number.MAX_SAFE_INTEGER)
  const context = await parseContext(canonicalProductProductionJsonV2(input.context))
  const draft = parseDraft(draftFromArtifact(input.artifact, context), context)
  const rebuilt = await createArtifact({ context, draft, createdAt: input.artifact.createdAt })
  if (canonicalProductProductionJsonV2(rebuilt) !== canonicalProductProductionJsonV2(input.artifact)) {
    fail('遭遇需求覆盖、敌人数值、稳定键、奖励预留或运行绑定被篡改')
  }
  return structuredClone(input.artifact)
}

export async function projectTextOpenWorldEncounterCatalogAuthorEditableDraftV1(input: {
  artifact: TextOpenWorldEnemyEncounterCatalogV1
  context: TextOpenWorldEncounterCatalogInputContextV1 | string
}): Promise<unknown> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const artifact = await validateTextOpenWorldEnemyEncounterCatalogV1({ artifact: input.artifact, context })
  return structuredClone(draftFromArtifact(artifact, context))
}

export async function rebuildTextOpenWorldEncounterCatalogFromAuthorEditableDraftV1(input: {
  baseArtifact: TextOpenWorldEnemyEncounterCatalogV1
  context: TextOpenWorldEncounterCatalogInputContextV1 | string
  draft: unknown
}): Promise<TextOpenWorldEnemyEncounterCatalogV1> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const baseArtifact = await validateTextOpenWorldEnemyEncounterCatalogV1({ artifact: input.baseArtifact, context })
  const artifact = await createArtifact({
    context,
    draft: parseDraft(input.draft, context),
    createdAt: baseArtifact.createdAt,
  })
  return validateTextOpenWorldEnemyEncounterCatalogV1({ artifact, context })
}

function systemPrompt(context: TextOpenWorldEncounterCatalogInputContextV1): string {
  return [
    '你是StoryForge文字开放世界Enemy与Encounter Catalog Designer。你为每项encounterDemand设计一个敌人和一个可玩的单组遭遇；代码负责稳定键、数值公式、技能策略、任务消费者、奖励/掉落预留和运行绑定。',
    `encounterDemands共有${context.encounterDemands.length}项，必须按demandNumber顺序精确覆盖。语义必须服从需求的title/description/requestedTraits、regionKey和候选地点；locationNumber是一基candidateLocationKeys序号。`,
    'enemyArchetype只能balanced/brute/swift/armored；recommendedLevel为1到20；intensity只能ordinary/dangerous/boss；enemyCount为1到5。保护需求通常不能靠极端等级制造主线锁死，首版战斗失败始终可重试或无代价复活。',
    '只写敌人、遭遇的可见语义和开战/胜利/失败文本。不要输出属性数值、技能键、任务键、奖励、掉落、Action、Effect、Condition或媒资引用。敌人与遭遇标题分别不得重复。',
    '只输出字段精确的JSON：',
    '{"schema":"storyforge.text-open-world-encounter-catalog-draft","version":1,"encounters":[{"demandNumber":1,"enemyTitle":"...","enemyDescription":"...","enemyTags":["..."],"enemyArchetype":"balanced","encounterTitle":"...","encounterDescription":"...","locationNumber":1,"recommendedLevel":1,"intensity":"ordinary","enemyCount":1,"openingText":"...","victoryText":"...","defeatText":"..."}]}',
  ].join('\n')
}

async function defaultModelRunner(input: Parameters<TextOpenWorldEncounterCatalogModelRunnerV1>[0]): Promise<TextOpenWorldEncounterCatalogModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId, requirementKey: input.requirementKey,
    expectedCapabilityHash: input.expectedCapabilityHash, category: input.category,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: `以下是已登记并验签的敌人与遭遇目录输入：\n<encounter-catalog-input>\n${input.contextText}\n</encounter-catalog-input>` }],
    maximumOutputTokens: input.maximumOutputTokens, signal: input.signal, result, responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

export function createTextOpenWorldEncounterCatalogExecutorV1(options: {
  runModel?: TextOpenWorldEncounterCatalogModelRunnerV1
  now?: () => number
} = {}): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultModelRunner; const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p8.catalog.encounters' || execution.task.skillId !== SKILL_ID || execution.task.executionMode !== 'model') fail('executor只接受P8 Encounter Catalog任务')
    if (canonicalProductProductionJsonV2(execution.task.outputArtifactKeys) !== canonicalProductProductionJsonV2(['text-open-world.enemy-encounter-catalog'])) fail('Encounter Catalog输出Artifact集合不精确')
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('Encounter Catalog需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!
    const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey)
    if (!binding) fail('Encounter Catalog缺少文本capability binding')
    const context = await parseContext(execution.contextText); const prompt = systemPrompt(context); const startedAt = performance.now()
    const response = await runModel({
      projectId: execution.scope.projectId, requirementKey, expectedCapabilityHash: binding.bindingHash,
      category: 'text-open-world.production.encounter-catalog',
      system: prompt, contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(28_000, execution.task.budgetReservation.outputTokens)), signal: execution.signal,
    })
    if (response.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
    const draft = parseDraft(parseProductionModelJsonObjectV1(response.output, 'text-open-world-encounter-catalog'), context)
    const artifact = await validateTextOpenWorldEnemyEncounterCatalogV1({
      artifact: await createArtifact({ context, draft, createdAt: integer(now(), 'createdAt', 0, Number.MAX_SAFE_INTEGER) }), context,
    })
    return {
      artifacts: [{
        artifactKey: 'text-open-world.enemy-encounter-catalog', kind: 'text-open-world.enemy-encounter-catalog', payload: artifact,
        quality: { requirementCoverage: true, combatObjectiveCoverage: true, regionCoverage: true, deterministicStats: true, rewardsDeferred: true },
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
