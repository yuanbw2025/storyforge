import type { ChatResult } from '../ai/client'
import { estimateTokens } from '../ai/context-budget'
import { db } from '../db/schema'
import { readAcceptedBuildArtifacts } from '../product-production/artifact-store'
import { runConfiguredProductionTextV1, type ProviderBindingReceiptV1 } from '../product-production/capabilities'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import { parseProductionModelJsonObjectV1 } from '../product-production/production-executor'
import type {
  ProductProductionTaskExecutionResultV1,
  ProductProductionTaskExecutorV1,
} from '../product-production/scheduler'
import type { AssembleContextInput } from '../registry/types'
import type {
  ProductBuildArtifactRecordV1,
  TextOpenWorldContentRequirementManifestV1,
  TextOpenWorldGameplayRulesetSkeletonV1,
  TextOpenWorldPlayerBuildV1,
  TextOpenWorldProgressionCatalogsV1,
  TextOpenWorldProgressionSkillDemandKindV1,
  TextOpenWorldQuestSkeletonsV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { validateTextOpenWorldGameplayRulesetSkeletonV1 } from './gameplay-ruleset'

const SKILL_ID = 'text-open-world.production.progression-catalogs.v1'
const MAX_CONTEXT_CHARS = 180_000
const LEVEL_UNLOCKS = [2, 4, 7, 10, 14, 18] as const
const ACTIVATIONS = ['active', 'passive'] as const
const SKILL_KINDS = ['attack', 'status', 'resource', 'recovery'] as const
const TARGETS = ['self', 'single-enemy', 'all-enemies'] as const
const ATTRIBUTES = ['power', 'vitality', 'agility'] as const
const POLARITIES = ['beneficial', 'harmful', 'neutral'] as const

interface SkillDemandV1 {
  demandNumber: number
  sourceDemandKey: string
  demandKind: TextOpenWorldProgressionSkillDemandKindV1
  fixedSkillKey: string | null
  fixedTitle: string | null
  fixedDescription: string | null
  fixedMechanics: {
    activation: 'active' | 'passive'
    kind: 'attack' | 'status' | 'resource' | 'recovery'
    target: 'self' | 'single-enemy' | 'all-enemies'
    scalingAttribute: 'power' | 'vitality' | 'agility' | null
    resourceCost: number
    cooldownTurns: number
  } | null
  unlockPlan:
    | { kind: 'initial'; level: null; requirementKey: null }
    | { kind: 'level'; level: number; requirementKey: null }
    | { kind: 'quest-requirement'; level: null; requirementKey: string }
  semanticBrief: string
  requestedTraits: string[]
}

export interface TextOpenWorldProgressionCatalogsInputContextV1 {
  schema: 'storyforge.text-open-world-progression-catalogs-input'
  version: 1
  productInstanceKey: string
  gameplayRuleset: TextOpenWorldGameplayRulesetSkeletonV1
  playerBuild: TextOpenWorldPlayerBuildV1
  questSkeletons: TextOpenWorldQuestSkeletonsV1
  contentRequirementManifest: TextOpenWorldContentRequirementManifestV1
  skillDemands: SkillDemandV1[]
  contextSelectionHash: string
}

export interface TextOpenWorldProgressionCatalogsModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldProgressionCatalogsModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldProgressionCatalogsModelExecutionV1>

interface SkillDraftV1 {
  demandNumber: number
  title: string
  description: string
  tags: string[]
  activation: 'active' | 'passive'
  kind: 'attack' | 'status' | 'resource' | 'recovery'
  target: 'self' | 'single-enemy' | 'all-enemies'
  scalingAttribute: 'power' | 'vitality' | 'agility' | null
  priority: number
  resourceCost: number
  cooldownTurns: number
  combatPowerNumerator: number | null
  combatPowerDenominator: number | null
  flatDamage: number | null
}

interface ProgressionDraftV1 {
  skills: SkillDraftV1[]
  statuses: Array<{
    title: string
    description: string
    polarity: 'beneficial' | 'harmful' | 'neutral'
  }>
}

function fail(message: string): never { throw new Error(`[text-open-world-progression-catalogs] ${message}`) }

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || expected.some((key, index) => key !== actual[index])) {
    fail(`${label}字段不精确:${actual.join(',')}`)
  }
}

function text(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== 'string') fail(`${label}必须是字符串`)
  const normalized = value.trim().normalize('NFC')
  if (!normalized || normalized.length > maximum) fail(`${label}为空或过长`)
  return normalized
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(`${label}必须是${minimum}到${maximum}之间的整数`)
  }
  return Number(value)
}

function nullableInteger(value: unknown, label: string, minimum: number, maximum: number): number | null {
  return value === null ? null : integer(value, label, minimum, maximum)
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label}不在允许闭集`)
  return value as T
}

function nullableEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T | null {
  return value === null ? null : enumValue(value, allowed, label)
}

function stringArray(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) fail(`${label}必须是1到${maximum}项数组`)
  const result = value.map((item, index) => text(item, `${label}[${index}]`, 300))
  if (new Set(result).size !== result.length) fail(`${label}不得重复`)
  return result
}

function artifact<T>(row: ProductBuildArtifactRecordV1, key: string): T {
  if (row.artifactKey !== key || row.kind !== key) fail(`Artifact身份错误:${key}`)
  try { return JSON.parse(row.payloadJson) as T } catch { return fail(`Artifact JSON损坏:${key}`) }
}

function unique(rows: ProductBuildArtifactRecordV1[], key: string): ProductBuildArtifactRecordV1 {
  const matched = rows.filter(row => row.artifactKey === key && (row.status === 'accepted' || row.status === 'carried-forward'))
  if (matched.length !== 1) fail(`需要唯一已验收Artifact:${key}`)
  return matched[0]!
}

async function assertOwnHash(value: Record<string, unknown>, hashKey: string, label: string): Promise<void> {
  const ownHash = value[hashKey]
  if (!isSha256Hash(ownHash)) fail(`${label} Hash字段无效`)
  const body = { ...value }; delete body[hashKey]
  if (await hashProductProductionValueV2(body) !== ownHash) fail(`${label} Hash不匹配`)
}

function buildSkillDemands(input: {
  playerBuild: TextOpenWorldPlayerBuildV1
  manifest: TextOpenWorldContentRequirementManifestV1
}): SkillDemandV1[] {
  const demands: SkillDemandV1[] = []
  input.playerBuild.catalogRequirements.skills.forEach(skill => demands.push({
    demandNumber: demands.length + 1,
    sourceDemandKey: `player-build.${skill.key}`,
    demandKind: 'player-initial',
    fixedSkillKey: skill.key,
    fixedTitle: skill.title,
    fixedDescription: skill.description,
    fixedMechanics: {
      activation: skill.activation,
      kind: skill.kind,
      target: skill.target,
      scalingAttribute: skill.scalingAttribute,
      resourceCost: skill.resourceCost,
      cooldownTurns: skill.cooldownTurns,
    },
    unlockPlan: { kind: 'initial', level: null, requirementKey: null },
    semanticBrief: skill.role === 'basic-attack' ? '稳定、零消耗的基础战斗行动。' : `主角标志能力，战斗用途：${skill.combatPurpose}`,
    requestedTraits: [skill.role],
  }))
  LEVEL_UNLOCKS.forEach(level => demands.push({
    demandNumber: demands.length + 1,
    sourceDemandKey: `progression-level.${String(level).padStart(3, '0')}`,
    demandKind: 'level-progression',
    fixedSkillKey: null,
    fixedTitle: null,
    fixedDescription: null,
    fixedMechanics: null,
    unlockPlan: { kind: 'level', level, requirementKey: null },
    semanticBrief: `作为${level}级自动解锁能力，扩展当前构筑而不建立职业系统。`,
    requestedTraits: level <= 4 ? ['验收世界可见成长'] : ['长期成长'],
  }))
  const skillRequirements = input.manifest.requirements.filter(requirement => requirement.ownerTaskKey === 'p8.catalog.progression')
  skillRequirements.forEach(requirement => {
    if (requirement.kind !== 'skill' || requirement.sourceReservationKey !== null
      || requirement.binding.status !== 'catalog-unbound' || requirement.binding.definitionKeys.length) {
      fail(`成长目录收到非法内容需求:${requirement.key}`)
    }
    for (let index = 0; index < requirement.minimumCount; index += 1) {
      demands.push({
        demandNumber: demands.length + 1,
        sourceDemandKey: `${requirement.key}.${String(index + 1).padStart(3, '0')}`,
        demandKind: 'quest-requirement',
        fixedSkillKey: null,
        fixedTitle: requirement.minimumCount === 1 ? requirement.title : `${requirement.title} ${index + 1}`,
        fixedDescription: requirement.description,
        fixedMechanics: null,
        unlockPlan: { kind: 'quest-requirement', level: null, requirementKey: requirement.key },
        semanticBrief: requirement.description,
        requestedTraits: requirement.requestedTraits,
      })
    }
  })
  if (demands.length > 80) fail('技能需求超过单Build首版上限80')
  return demands
}

async function validateUpstream(context: Omit<TextOpenWorldProgressionCatalogsInputContextV1, 'contextSelectionHash'>): Promise<void> {
  const { gameplayRuleset, playerBuild, questSkeletons, contentRequirementManifest } = context
  await validateTextOpenWorldGameplayRulesetSkeletonV1({ artifact: gameplayRuleset })
  if (playerBuild.schema !== 'storyforge.text-open-world-player-build' || playerBuild.version !== 1
    || playerBuild.catalogBinding.status !== 'reserved-unbound'
    || playerBuild.catalogBinding.playerDefinitionReady !== false) fail('PlayerBuild身份或目录等待状态无效')
  await assertOwnHash(playerBuild as unknown as Record<string, unknown>, 'playerBuildHash', 'PlayerBuild')
  if (gameplayRuleset.productInstanceKey !== context.productInstanceKey
    || playerBuild.productInstanceKey !== context.productInstanceKey
    || playerBuild.gameplayRulesetHash !== gameplayRuleset.gameplayRulesetHash
    || questSkeletons.schema !== 'storyforge.text-open-world-quest-skeletons'
    || questSkeletons.version !== 1
    || questSkeletons.productInstanceKey !== context.productInstanceKey
    || contentRequirementManifest.schema !== 'storyforge.text-open-world-content-requirement-manifest'
    || contentRequirementManifest.version !== 1
    || contentRequirementManifest.productInstanceKey !== context.productInstanceKey
    || contentRequirementManifest.questSkeletonsHash !== questSkeletons.questSkeletonsHash) fail('成长目录上游身份或引用无效')
  await assertOwnHash(questSkeletons as unknown as Record<string, unknown>, 'questSkeletonsHash', 'QuestSkeletons')
  await assertOwnHash(contentRequirementManifest as unknown as Record<string, unknown>, 'contentRequirementManifestHash', 'ContentRequirementManifest')
  const expected = buildSkillDemands({ playerBuild, manifest: contentRequirementManifest })
  if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(context.skillDemands)) {
    fail('skillDemands不是PlayerBuild和Manifest的确定性投影')
  }
}

async function loadContext(input: { scope: WorkspaceScope; productionId: number; buildId: number }): Promise<TextOpenWorldProgressionCatalogsInputContextV1> {
  const [production, build, rows] = await Promise.all([
    db.productProductions.get(input.productionId), db.productBuilds.get(input.buildId),
    readAcceptedBuildArtifacts({ scope: input.scope, buildId: input.buildId }),
  ])
  if (!production || production.productType !== 'text-open-world'
    || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) fail('Production不存在、跨Work或类型错误')
  if (!build || build.productionId !== production.id
    || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) fail('Build不属于当前Production/Work')
  const gameplayRow = unique(rows, 'text-open-world.gameplay-ruleset-skeleton')
  const playerRow = unique(rows, 'text-open-world.player-build')
  const questRow = unique(rows, 'text-open-world.quest-skeletons')
  const manifestRow = unique(rows, 'text-open-world.content-requirement-manifest')
  const gameplayRuleset = artifact<TextOpenWorldGameplayRulesetSkeletonV1>(gameplayRow, gameplayRow.artifactKey)
  const playerBuild = artifact<TextOpenWorldPlayerBuildV1>(playerRow, playerRow.artifactKey)
  const questSkeletons = artifact<TextOpenWorldQuestSkeletonsV1>(questRow, questRow.artifactKey)
  const contentRequirementManifest = artifact<TextOpenWorldContentRequirementManifestV1>(manifestRow, manifestRow.artifactKey)
  for (const [row, payload] of [[gameplayRow, gameplayRuleset], [playerRow, playerBuild], [questRow, questSkeletons], [manifestRow, contentRequirementManifest]] as const) {
    if (await hashProductProductionValueV2(payload) !== row.contentHash) fail(`Artifact行Hash不匹配:${row.artifactKey}`)
  }
  const body: Omit<TextOpenWorldProgressionCatalogsInputContextV1, 'contextSelectionHash'> = {
    schema: 'storyforge.text-open-world-progression-catalogs-input', version: 1,
    productInstanceKey: production.productionKey, gameplayRuleset, playerBuild, questSkeletons, contentRequirementManifest,
    skillDemands: buildSkillDemands({ playerBuild, manifest: contentRequirementManifest }),
  }
  await validateUpstream(body)
  const context = { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('ProgressionCatalog Context超过硬上限')
  return context
}

export async function readTextOpenWorldProgressionCatalogsInputContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !Number.isSafeInteger(input.productProductionId) || !Number.isSafeInteger(input.productBuildId)) {
    fail('Context读取缺少scope/production/build selector')
  }
  return canonicalProductProductionJsonV2(await loadContext({
    scope: input.scope, productionId: input.productProductionId!, buildId: input.productBuildId!,
  }))
}

async function parseContext(value: string): Promise<TextOpenWorldProgressionCatalogsInputContextV1> {
  let context: TextOpenWorldProgressionCatalogsInputContextV1
  try { context = JSON.parse(value) as TextOpenWorldProgressionCatalogsInputContextV1 } catch { return fail('Context JSON损坏') }
  if (context.schema !== 'storyforge.text-open-world-progression-catalogs-input' || context.version !== 1) fail('Context身份无效')
  const { contextSelectionHash, ...body } = context
  await validateUpstream(body)
  if (!isSha256Hash(contextSelectionHash) || await hashProductProductionValueV2(body) !== contextSelectionHash) fail('Context选择Hash不匹配')
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Context超过硬上限')
  return context
}

function parseDraft(value: unknown, context: TextOpenWorldProgressionCatalogsInputContextV1): ProgressionDraftV1 {
  const root = record(value, 'draft')
  exactKeys(root, ['schema', 'version', 'skills', 'statuses'], 'draft')
  if (root.schema !== 'storyforge.text-open-world-progression-catalogs-draft' || root.version !== 1) fail('draft schema/version无效')
  if (!Array.isArray(root.skills) || root.skills.length !== context.skillDemands.length) {
    fail(`skills必须与${context.skillDemands.length}项skillDemands一一对应`)
  }
  const skills = root.skills.map((item, index) => {
    const row = record(item, `skills[${index}]`)
    exactKeys(row, [
      'demandNumber', 'title', 'description', 'tags', 'activation', 'kind', 'target', 'scalingAttribute',
      'priority', 'resourceCost', 'cooldownTurns', 'combatPowerNumerator', 'combatPowerDenominator', 'flatDamage',
    ], `skills[${index}]`)
    const demandNumber = integer(row.demandNumber, `skills[${index}].demandNumber`, 1, context.skillDemands.length)
    const demand = context.skillDemands[demandNumber - 1]!
    const activation = enumValue(row.activation, ACTIVATIONS, `skills[${index}].activation`)
    const kind = enumValue(row.kind, SKILL_KINDS, `skills[${index}].kind`)
    const target = enumValue(row.target, TARGETS, `skills[${index}].target`)
    const scalingAttribute = nullableEnum(row.scalingAttribute, ATTRIBUTES, `skills[${index}].scalingAttribute`)
    const resourceCost = integer(row.resourceCost, `skills[${index}].resourceCost`, 0, 20)
    const cooldownTurns = integer(row.cooldownTurns, `skills[${index}].cooldownTurns`, 0, 10)
    const combatPowerNumerator = nullableInteger(row.combatPowerNumerator, `skills[${index}].combatPowerNumerator`, 0, 20)
    const combatPowerDenominator = nullableInteger(row.combatPowerDenominator, `skills[${index}].combatPowerDenominator`, 1, 20)
    const flatDamage = nullableInteger(row.flatDamage, `skills[${index}].flatDamage`, 0, 1_000)
    const combatRequired = activation === 'active' && kind === 'attack'
    if (combatRequired !== (combatPowerNumerator !== null && combatPowerDenominator !== null && flatDamage !== null)) {
      fail(`主动攻击技能必须且只能声明完整战斗公式:${demand.sourceDemandKey}`)
    }
    if (activation === 'passive' && (target !== 'self' || resourceCost !== 0 || cooldownTurns !== 0)) {
      fail(`被动技能必须以自身为目标且无主动消耗:${demand.sourceDemandKey}`)
    }
    if (activation === 'active' && kind === 'attack' && target === 'self') fail(`主动攻击技能不能以自身为目标:${demand.sourceDemandKey}`)
    const parsed = {
      demandNumber,
      title: text(row.title, `skills[${index}].title`, 200),
      description: text(row.description, `skills[${index}].description`),
      tags: stringArray(row.tags, `skills[${index}].tags`, 8),
      activation, kind, target, scalingAttribute,
      priority: integer(row.priority, `skills[${index}].priority`, 0, 1_000),
      resourceCost, cooldownTurns, combatPowerNumerator, combatPowerDenominator, flatDamage,
    }
    if (demand.fixedTitle !== null && parsed.title !== demand.fixedTitle) fail(`PlayerBuild技能标题不可改写:${demand.fixedSkillKey}`)
    if (demand.fixedDescription !== null && parsed.description !== demand.fixedDescription) fail(`PlayerBuild技能说明不可改写:${demand.fixedSkillKey}`)
    if (demand.fixedMechanics !== null && canonicalProductProductionJsonV2({ activation, kind, target, scalingAttribute, resourceCost, cooldownTurns })
      !== canonicalProductProductionJsonV2(demand.fixedMechanics)) fail(`PlayerBuild技能机制不可改写:${demand.fixedSkillKey}`)
    return parsed
  })
  const demandNumbers = skills.map(skill => skill.demandNumber)
  if (new Set(demandNumbers).size !== context.skillDemands.length) fail('每项skillDemand必须且只能生成一个技能')
  if (demandNumbers.some((demandNumber, index) => demandNumber !== index + 1)) {
    fail('skills必须按skillDemands顺序返回')
  }
  for (let index = 1; index <= context.skillDemands.length; index += 1) {
    if (!demandNumbers.includes(index)) fail(`skillDemand未覆盖:${index}`)
  }
  const titles = skills.map(skill => skill.title.toLocaleLowerCase('zh-CN'))
  if (new Set(titles).size !== titles.length) fail('技能标题不得重复')
  if (!Array.isArray(root.statuses) || root.statuses.length < 1 || root.statuses.length > 6) fail('statuses必须有1到6项')
  const statuses = root.statuses.map((item, index) => {
    const row = record(item, `statuses[${index}]`)
    exactKeys(row, ['title', 'description', 'polarity'], `statuses[${index}]`)
    return {
      title: text(row.title, `statuses[${index}].title`, 200),
      description: text(row.description, `statuses[${index}].description`),
      polarity: enumValue(row.polarity, POLARITIES, `statuses[${index}].polarity`),
    }
  })
  const statusTitles = statuses.map(status => status.title.toLocaleLowerCase('zh-CN'))
  if (new Set(statusTitles).size !== statuses.length) fail('状态标题不得重复')
  return { skills, statuses }
}

function skillKey(demand: SkillDemandV1, requirementIndex: number): string {
  if (demand.fixedSkillKey) return demand.fixedSkillKey
  if (demand.demandKind === 'level-progression') return `skill.level.${String(demand.unlockPlan.level).padStart(3, '0')}`
  return `skill.requirement.${String(requirementIndex).padStart(3, '0')}`
}

function growthForLevel(level: number, playerBuild: TextOpenWorldPlayerBuildV1) {
  if (level === 1) return { power: 0, vitality: 0, agility: 0 }
  const result = { power: 0, vitality: 0, agility: 0 }
  result[playerBuild.playstyle.primaryAttribute] += 1
  if (level % 2 === 0) result[playerBuild.playstyle.secondaryAttribute] += 1
  const tertiary = ATTRIBUTES.find(attribute => attribute !== playerBuild.playstyle.primaryAttribute
    && attribute !== playerBuild.playstyle.secondaryAttribute)!
  if (level % 3 === 0) result[tertiary] += 1
  return result
}

async function createArtifact(input: {
  context: TextOpenWorldProgressionCatalogsInputContextV1
  draft: ProgressionDraftV1
  createdAt: number
}): Promise<TextOpenWorldProgressionCatalogsV1> {
  let requirementIndex = 0
  const skills = input.draft.skills.map((draftSkill, index) => {
    const demand = input.context.skillDemands[draftSkill.demandNumber - 1]!
    if (demand.demandKind === 'quest-requirement') requirementIndex += 1
    const combatRequired = draftSkill.activation === 'active' && draftSkill.kind === 'attack'
    return {
      key: skillKey(demand, requirementIndex),
      order: index + 1,
      sourceDemandKey: demand.sourceDemandKey,
      demandKind: demand.demandKind,
      title: draftSkill.title,
      description: draftSkill.description,
      tags: draftSkill.tags,
      activation: draftSkill.activation,
      kind: draftSkill.kind,
      target: draftSkill.target,
      scalingAttribute: draftSkill.scalingAttribute,
      unlockPlan: demand.unlockPlan,
      priority: draftSkill.priority,
      resourceCost: draftSkill.resourceCost,
      cooldownTurns: draftSkill.cooldownTurns,
      combatResolutionPlan: {
        required: combatRequired,
        powerNumerator: draftSkill.combatPowerNumerator,
        powerDenominator: draftSkill.combatPowerDenominator,
        flatDamage: draftSkill.flatDamage,
      },
      fulfilledRequirementKeys: demand.unlockPlan.kind === 'quest-requirement' ? [demand.unlockPlan.requirementKey] : [],
      runtimeBinding: {
        status: 'runtime-unbound' as const, useConditionKeys: [] as [], effectKeys: [] as [], actionKey: null, unlockQuestKey: null,
      },
    }
  })
  if (new Set(skills.map(skill => skill.key)).size !== skills.length) fail('技能稳定键冲突')
  const skillsByDemand = new Map(skills.map(skill => [skill.sourceDemandKey, skill]))
  const levels = Array.from({ length: 20 }, (_, index) => {
    const level = index + 1
    return {
      level,
      cumulativeExperience: index * index * 100,
      attributeGrowth: growthForLevel(level, input.context.playerBuild),
      unlockedSkillKeys: skills.filter(skill => {
        const demand = input.context.skillDemands.find(candidate => candidate.sourceDemandKey === skill.sourceDemandKey)!
        return demand.unlockPlan.kind === 'initial' && level === 1
          || demand.unlockPlan.kind === 'level' && demand.unlockPlan.level === level
      }).map(skill => skill.key),
    }
  })
  const requiredSkillRequirementKeys = input.context.contentRequirementManifest.requirements
    .filter(requirement => requirement.ownerTaskKey === 'p8.catalog.progression').map(requirement => requirement.key)
  const coveredSkillRequirementKeys = [...new Set(skills.flatMap(skill => skill.fulfilledRequirementKeys))]
  const requiredPlayerSkillKeys = input.context.playerBuild.catalogRequirements.skills.map(skill => skill.key)
  const body: Omit<TextOpenWorldProgressionCatalogsV1, 'progressionCatalogsHash'> = {
    schema: 'storyforge.text-open-world-progression-catalogs', version: 1, productType: 'text-open-world',
    productInstanceKey: input.context.productInstanceKey,
    gameplayRulesetHash: input.context.gameplayRuleset.gameplayRulesetHash,
    playerBuildHash: input.context.playerBuild.playerBuildHash,
    questSkeletonsHash: input.context.questSkeletons.questSkeletonsHash,
    contentRequirementManifestHash: input.context.contentRequirementManifest.contentRequirementManifestHash,
    rules: {
      maximumLevel: 20,
      automaticAttributeGrowth: true,
      levelUp: { resourcePolicy: 'increase-by-cap-delta', maximumLevelExperiencePolicy: 'cap-at-threshold' },
      attributes: {
        power: { label: input.context.gameplayRuleset.characterModel.attributes[0].label },
        vitality: { label: input.context.gameplayRuleset.characterModel.attributes[1].label },
        agility: { label: input.context.gameplayRuleset.characterModel.attributes[2].label },
      },
      formulas: input.context.gameplayRuleset.progression.formulas,
    },
    levels,
    skills,
    statuses: input.draft.statuses.map((status, index) => ({
      key: `status.catalog.${String(index + 1).padStart(3, '0')}`, order: index + 1, ...status,
    })),
    coverage: {
      requiredPlayerSkillKeys,
      coveredPlayerSkillKeys: requiredPlayerSkillKeys.filter(key => skills.some(skill => skill.key === key)),
      requiredSkillRequirementKeys,
      coveredSkillRequirementKeys,
      acceptanceLevelRange: { minimum: 1, maximum: 5 },
      acceptanceRangeUnlockSkillKeys: levels.slice(0, 5).flatMap(level => level.unlockedSkillKeys),
      fullLevelCount: levels.length as 20,
      uncoveredDemandKeys: [] as [],
    },
    governance: {
      professionSystem: 'none', attributeGrowthOwner: 'deterministic-compiler', experienceCurveOwner: 'deterministic-compiler',
      skillSemanticsOwner: 'model-validated', actionEffectBindingOwner: 'p8f.quest-finalize',
      allRuntimeBindingsUnbound: true, progressionModuleReady: false,
    },
    basisHash: await hashProductProductionValueV2({
      gameplayRulesetHash: input.context.gameplayRuleset.gameplayRulesetHash,
      playerBuildHash: input.context.playerBuild.playerBuildHash,
      questSkeletonsHash: input.context.questSkeletons.questSkeletonsHash,
      contentRequirementManifestHash: input.context.contentRequirementManifest.contentRequirementManifestHash,
      contextSelectionHash: input.context.contextSelectionHash,
      demandKeys: input.context.skillDemands.map(demand => demand.sourceDemandKey),
    }),
    createdAt: input.createdAt,
  }
  if (body.coverage.coveredPlayerSkillKeys.length !== requiredPlayerSkillKeys.length
    || canonicalProductProductionJsonV2([...body.coverage.coveredSkillRequirementKeys].sort())
      !== canonicalProductProductionJsonV2([...requiredSkillRequirementKeys].sort())
    || body.coverage.acceptanceRangeUnlockSkillKeys.length < 4
    || skillsByDemand.size !== input.context.skillDemands.length) fail('成长目录需求覆盖不完整')
  return { ...body, progressionCatalogsHash: await hashProductProductionValueV2(body) }
}

function draftFromArtifact(artifact: TextOpenWorldProgressionCatalogsV1): unknown {
  return {
    schema: 'storyforge.text-open-world-progression-catalogs-draft', version: 1,
    skills: artifact.skills.map(skill => ({
      demandNumber: skill.order,
      title: skill.title,
      description: skill.description,
      tags: skill.tags,
      activation: skill.activation,
      kind: skill.kind,
      target: skill.target,
      scalingAttribute: skill.scalingAttribute,
      priority: skill.priority,
      resourceCost: skill.resourceCost,
      cooldownTurns: skill.cooldownTurns,
      combatPowerNumerator: skill.combatResolutionPlan.powerNumerator,
      combatPowerDenominator: skill.combatResolutionPlan.powerDenominator,
      flatDamage: skill.combatResolutionPlan.flatDamage,
    })),
    statuses: artifact.statuses.map(status => ({ title: status.title, description: status.description, polarity: status.polarity })),
  }
}

export async function validateTextOpenWorldProgressionCatalogsV1(input: {
  artifact: TextOpenWorldProgressionCatalogsV1
  context: TextOpenWorldProgressionCatalogsInputContextV1
}): Promise<TextOpenWorldProgressionCatalogsV1> {
  if (input.artifact.schema !== 'storyforge.text-open-world-progression-catalogs' || input.artifact.version !== 1
    || !isSha256Hash(input.artifact.progressionCatalogsHash)) fail('ProgressionCatalog Artifact身份或Hash字段无效')
  integer(input.artifact.createdAt, 'createdAt', 0, Number.MAX_SAFE_INTEGER)
  const context = await parseContext(canonicalProductProductionJsonV2(input.context))
  const draft = parseDraft(draftFromArtifact(input.artifact), context)
  const rebuilt = await createArtifact({ context, draft, createdAt: input.artifact.createdAt })
  if (canonicalProductProductionJsonV2(rebuilt) !== canonicalProductProductionJsonV2(input.artifact)) {
    fail('成长曲线、需求覆盖、技能稳定键或未绑定运行槽被篡改')
  }
  return structuredClone(input.artifact)
}

function systemPrompt(context: TextOpenWorldProgressionCatalogsInputContextV1): string {
  return [
    '你是StoryForge文字开放世界Progression与Skill Catalog Designer。你只设计技能与状态语义和有界战斗参数；20级经验曲线、自动属性成长、稳定键、需求归属以及Action/Effect/Condition/Quest绑定由代码生成。',
    `skillDemands共有${context.skillDemands.length}项，必须按demandNumber精确覆盖一次。player-initial的title/description和全部机制必须与fixed字段一致；level-progression要形成无职业系统的长期成长；quest-requirement要兑现semanticBrief/requestedTraits。`,
    'activation只能active/passive，kind只能attack/status/resource/recovery，target只能self/single-enemy/all-enemies，scalingAttribute只能power/vitality/agility/null。passive必须self、0消耗、0冷却；主动attack不能self，且必须填写完整combatPowerNumerator/Denominator/flatDamage，其他技能三个战斗公式字段必须全为null。',
    'resourceCost为0到20整数，cooldownTurns为0到10整数，priority为0到1000整数；攻击倍率分子0到20、分母1到20、flatDamage 0到1000。不要输出Action、Effect、Condition、Quest、状态施加规则或任何目录键。',
    '另设计1到6个状态词典项，只给title、description、polarity(beneficial/harmful/neutral)，用于后序技能/战斗选择，不代表已绑定Effect。技能和状态标题均不得重复。',
    '只输出字段精确的JSON：',
    '{"schema":"storyforge.text-open-world-progression-catalogs-draft","version":1,"skills":[{"demandNumber":1,"title":"...","description":"...","tags":["..."],"activation":"active","kind":"attack","target":"single-enemy","scalingAttribute":"power","priority":100,"resourceCost":0,"cooldownTurns":0,"combatPowerNumerator":1,"combatPowerDenominator":1,"flatDamage":0}],"statuses":[{"title":"...","description":"...","polarity":"beneficial"}]}',
  ].join('\n')
}

async function defaultModelRunner(input: Parameters<TextOpenWorldProgressionCatalogsModelRunnerV1>[0]): Promise<TextOpenWorldProgressionCatalogsModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId, requirementKey: input.requirementKey, category: input.category,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: `以下是已登记并验签的成长目录输入：\n<progression-catalog-input>\n${input.contextText}\n</progression-catalog-input>` },
    ],
    maximumOutputTokens: input.maximumOutputTokens, signal: input.signal, result, responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

export function createTextOpenWorldProgressionCatalogsExecutorV1(options: {
  runModel?: TextOpenWorldProgressionCatalogsModelRunnerV1
  now?: () => number
} = {}): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultModelRunner
  const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p8.catalog.progression' || execution.task.skillId !== SKILL_ID
      || execution.task.executionMode !== 'model') fail('executor只接受P8 Progression Catalog任务')
    if (canonicalProductProductionJsonV2(execution.task.outputArtifactKeys)
      !== canonicalProductProductionJsonV2(['text-open-world.progression-catalogs'])) fail('Progression Catalog输出Artifact集合不精确')
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('Progression Catalog需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!
    const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey)
    if (!binding) fail('Progression Catalog缺少文本capability binding')
    const context = await parseContext(execution.contextText)
    const prompt = systemPrompt(context)
    const startedAt = performance.now()
    const response = await runModel({
      projectId: execution.scope.projectId, requirementKey, category: 'text-open-world.production.progression-catalogs',
      system: prompt, contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(24_000, execution.task.budgetReservation.outputTokens)),
      signal: execution.signal,
    })
    if (response.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
    const draft = parseDraft(parseProductionModelJsonObjectV1(response.output, 'text-open-world-progression-catalogs'), context)
    const artifact = await validateTextOpenWorldProgressionCatalogsV1({
      artifact: await createArtifact({ context, draft, createdAt: integer(now(), 'createdAt', 0, Number.MAX_SAFE_INTEGER) }), context,
    })
    return {
      artifacts: [{
        artifactKey: 'text-open-world.progression-catalogs', kind: 'text-open-world.progression-catalogs', payload: artifact,
        quality: { fullLevelCurve: true, playerBuildSatisfied: true, skillRequirementsSatisfied: true, runtimeBindingsUnbound: true },
        rights: { contentRequirementManifestHash: context.contentRequirementManifest.contentRequirementManifestHash },
      }],
      passedGateIds: [...execution.task.acceptanceGateIds],
      usage: {
        modelCalls: 1,
        inputTokens: response.usage?.inputTokens ?? estimateTokens(execution.contextText + prompt),
        outputTokens: response.usage?.outputTokens ?? estimateTokens(response.output),
        mediaCalls: 0, costUsd: null,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)), storageBytes: 0,
      },
    } satisfies ProductProductionTaskExecutionResultV1
  }
}
