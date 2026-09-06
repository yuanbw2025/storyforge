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
  TextOpenWorldContentRequirementKindV1,
  TextOpenWorldContentRequirementManifestV1,
  TextOpenWorldExperienceContractV1,
  TextOpenWorldGameBriefV1,
  TextOpenWorldGameplayRulesetSkeletonV1,
  TextOpenWorldMainlineThreadV1,
  TextOpenWorldQuestObjectiveIntentV1,
  TextOpenWorldQuestSkeletonsV1,
  TextOpenWorldQuestSkeletonSourceKindV1,
  TextOpenWorldRegionNarrativePacksV1,
  TextOpenWorldSignificantThreadsV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { validateTextOpenWorldGameplayRulesetSkeletonV1 } from './gameplay-ruleset'

const SKILL_ID = 'text-open-world.production.quest-skeletons.v1'
const MAX_CONTEXT_CHARS = 300_000
const SOURCE_KINDS = ['mainline-stage', 'significant-stage', 'ordinary-seed', 'template-seed'] as const
const OBJECTIVE_INTENTS = [
  'dialogue', 'investigate', 'explore', 'combat', 'collect',
  'craft', 'trade', 'choice', 'travel', 'interact',
] as const
const REQUIREMENT_KINDS = [
  'actor', 'faction', 'enemy', 'encounter', 'item', 'equipment', 'material',
  'skill', 'recipe', 'vendor', 'reward', 'action', 'location-interaction',
] as const
const CRITICALITIES = ['ordinary', 'important', 'protected'] as const

interface QuestSourceV1 {
  kind: TextOpenWorldQuestSkeletonSourceKindV1
  sourceKey: string
  sourceOrder: number
  title: string
  premise: string
  regionKeys: string[]
  locationKeys: string[]
  estimatedMinutes: number
  type: 'mainline' | 'significant' | 'ordinary' | 'template'
  storylineKey: string | null
  ownerKind: 'global' | 'actor' | 'faction' | 'region'
  ownerSemanticKey: string | null
}

export interface TextOpenWorldQuestSkeletonsInputContextV1 {
  schema: 'storyforge.text-open-world-quest-skeletons-input'
  version: 1
  productInstanceKey: string
  gameBrief: TextOpenWorldGameBriefV1
  experienceContract: TextOpenWorldExperienceContractV1
  gameplayRuleset: TextOpenWorldGameplayRulesetSkeletonV1
  mainlineThread: TextOpenWorldMainlineThreadV1
  significantThreads: TextOpenWorldSignificantThreadsV1
  regionNarrativePacks: TextOpenWorldRegionNarrativePacksV1
  questSources: QuestSourceV1[]
  contextSelectionHash: string
}

export interface TextOpenWorldQuestSkeletonArtifactsV1 {
  questSkeletons: TextOpenWorldQuestSkeletonsV1
  contentRequirementManifest: TextOpenWorldContentRequirementManifestV1
}

export interface TextOpenWorldQuestSkeletonsModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldQuestSkeletonsModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldQuestSkeletonsModelExecutionV1>

interface RequirementDraftV1 {
  kind: TextOpenWorldContentRequirementKindV1
  title: string
  description: string
  requestedTraits: string[]
  minimumCount: number
  criticality: 'ordinary' | 'important' | 'protected'
}

interface QuestSkeletonsDraftV1 {
  quests: Array<{
    sourceKind: TextOpenWorldQuestSkeletonSourceKindV1
    sourceNumber: number
    title: string
    premise: string
    storyMotivation: string
    intendedPlayerExperience: string
    timePolicy: 'waits' | 'timed'
    expirationMinutes: number | null
    stages: Array<{
      title: string
      purpose: string
      completionIntent: string
      objectives: Array<{
        title: string
        playerIntent: TextOpenWorldQuestObjectiveIntentV1
        successDescription: string
        optional: boolean
        requirements: RequirementDraftV1[]
      }>
    }>
  }>
}

function fail(message: string): never {
  throw new Error(`[text-open-world-quest-skeletons] ${message}`)
}

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

function timestamp(value: unknown, label: string): number {
  return integer(value, label, 0, Number.MAX_SAFE_INTEGER)
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label}不在允许闭集`)
  return value as T
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label}必须是布尔值`)
  return value
}

function nullableInteger(value: unknown, label: string, minimum: number, maximum: number): number | null {
  return value === null ? null : integer(value, label, minimum, maximum)
}

function stringArray(value: unknown, label: string, maximum: number, allowEmpty = false): string[] {
  if (!Array.isArray(value) || value.length > maximum || (!allowEmpty && value.length === 0)) {
    fail(`${label}必须是有界数组`)
  }
  const result = value.map((item, index) => text(item, `${label}[${index}]`, 500))
  if (new Set(result).size !== result.length) fail(`${label}不得重复`)
  return result
}

function parseArtifact<T>(row: ProductBuildArtifactRecordV1, key: string): T {
  if (row.artifactKey !== key || row.kind !== key) fail(`Artifact身份错误:${key}`)
  try { return JSON.parse(row.payloadJson) as T }
  catch { return fail(`Artifact JSON损坏:${key}`) }
}

function uniqueAcceptedArtifact(rows: ProductBuildArtifactRecordV1[], key: string): ProductBuildArtifactRecordV1 {
  const matched = rows.filter(row => row.artifactKey === key
    && (row.status === 'accepted' || row.status === 'carried-forward'))
  if (matched.length !== 1) fail(`需要唯一已验收Artifact:${key}`)
  return matched[0]!
}

async function assertOwnHash(value: Record<string, unknown>, hashKey: string, label: string): Promise<void> {
  const hash = value[hashKey]
  if (!isSha256Hash(hash)) fail(`${label} Hash字段无效`)
  const body = { ...value }
  delete body[hashKey]
  if (await hashProductProductionValueV2(body) !== hash) fail(`${label} Hash不匹配`)
}

function buildQuestSources(input: {
  mainlineThread: TextOpenWorldMainlineThreadV1
  significantThreads: TextOpenWorldSignificantThreadsV1
  regionNarrativePacks: TextOpenWorldRegionNarrativePacksV1
}): QuestSourceV1[] {
  const sources: QuestSourceV1[] = []
  input.mainlineThread.stages.forEach(stage => sources.push({
    kind: 'mainline-stage', sourceKey: stage.key, sourceOrder: stage.order,
    title: stage.title, premise: stage.summary, regionKeys: stage.regionKeys,
    locationKeys: stage.locationKeys, estimatedMinutes: stage.estimatedMinutes,
    type: 'mainline', storylineKey: input.mainlineThread.thread.key,
    ownerKind: 'global', ownerSemanticKey: null,
  }))
  input.significantThreads.stages.forEach((stage, index) => {
    const thread = input.significantThreads.threads.find(candidate => candidate.key === stage.threadKey)
      ?? fail(`重要故事Stage缺少Thread:${stage.key}`)
    sources.push({
      kind: 'significant-stage', sourceKey: stage.key, sourceOrder: index + 1,
      title: stage.title, premise: stage.summary, regionKeys: stage.regionKeys,
      locationKeys: stage.locationKeys, estimatedMinutes: stage.estimatedMinutes,
      type: 'significant', storylineKey: thread.key,
      ownerKind: thread.ownerKind === 'character' ? 'actor' : thread.ownerKind,
      ownerSemanticKey: thread.ownerKey,
    })
  })
  let ordinaryOrder = 0
  let templateOrder = 0
  input.regionNarrativePacks.packs.forEach(pack => {
    pack.ordinaryQuestSeeds.forEach(seed => {
      ordinaryOrder += 1
      sources.push({
        kind: 'ordinary-seed', sourceKey: seed.key, sourceOrder: ordinaryOrder,
        title: seed.title, premise: seed.premise, regionKeys: [pack.regionKey],
        locationKeys: seed.locationKeys, estimatedMinutes: seed.estimatedMinutes,
        type: 'ordinary', storylineKey: null, ownerKind: 'region', ownerSemanticKey: pack.regionKey,
      })
    })
    pack.taskTemplateSeeds.forEach(seed => {
      templateOrder += 1
      sources.push({
        kind: 'template-seed', sourceKey: seed.key, sourceOrder: templateOrder,
        title: seed.title, premise: seed.storyFrame, regionKeys: [pack.regionKey],
        locationKeys: seed.locationKeys, estimatedMinutes: 15,
        type: 'template', storylineKey: null, ownerKind: 'region', ownerSemanticKey: pack.regionKey,
      })
    })
  })
  return sources
}

async function validateUpstream(
  context: Omit<TextOpenWorldQuestSkeletonsInputContextV1, 'contextSelectionHash'>,
): Promise<void> {
  const { gameBrief, experienceContract, gameplayRuleset, mainlineThread, significantThreads, regionNarrativePacks } = context
  if (gameBrief.schema !== 'storyforge.text-open-world-game-brief' || gameBrief.version !== 1
    || gameBrief.productInstanceKey !== context.productInstanceKey) fail('GameBrief身份无效')
  await assertOwnHash(gameBrief as unknown as Record<string, unknown>, 'gameBriefHash', 'GameBrief')
  if (experienceContract.schema !== 'storyforge.text-open-world-experience-contract' || experienceContract.version !== 1
    || experienceContract.productInstanceKey !== context.productInstanceKey
    || experienceContract.gameBriefHash !== gameBrief.gameBriefHash
    || experienceContract.narrative.mainline !== 'strict-sequential-protected'
    || experienceContract.narrative.importantStorylines !== 'persistent-safe-wait') fail('ExperienceContract身份或任务保护边界无效')
  await assertOwnHash(experienceContract as unknown as Record<string, unknown>, 'experienceContractHash', 'ExperienceContract')
  await validateTextOpenWorldGameplayRulesetSkeletonV1({ artifact: gameplayRuleset })
  if (gameplayRuleset.productInstanceKey !== context.productInstanceKey
    || gameplayRuleset.gameBriefHash !== gameBrief.gameBriefHash) fail('GameplayRuleset上游无效')
  if (mainlineThread.schema !== 'storyforge.text-open-world-mainline-thread' || mainlineThread.version !== 1
    || mainlineThread.productInstanceKey !== context.productInstanceKey
    || mainlineThread.gameBriefHash !== gameBrief.gameBriefHash
    || mainlineThread.governance.allStagesReachable !== true) fail('MainlineThread身份或可达性无效')
  await assertOwnHash(mainlineThread as unknown as Record<string, unknown>, 'mainlineThreadHash', 'MainlineThread')
  if (significantThreads.schema !== 'storyforge.text-open-world-significant-threads' || significantThreads.version !== 1
    || significantThreads.productInstanceKey !== context.productInstanceKey
    || significantThreads.mainlineThreadHash !== mainlineThread.mainlineThreadHash
    || significantThreads.governance.mainlineCompatibility !== 'cannot-block-or-rewrite') fail('SignificantThreads身份或主线兼容无效')
  await assertOwnHash(significantThreads as unknown as Record<string, unknown>, 'significantThreadsHash', 'SignificantThreads')
  if (regionNarrativePacks.schema !== 'storyforge.text-open-world-region-narrative-packs' || regionNarrativePacks.version !== 1
    || regionNarrativePacks.productInstanceKey !== context.productInstanceKey
    || regionNarrativePacks.mainlineThreadHash !== mainlineThread.mainlineThreadHash
    || regionNarrativePacks.significantThreadsHash !== significantThreads.significantThreadsHash
    || regionNarrativePacks.coverage.ordinaryQuestSeedCount !== gameBrief.scale.ordinaryQuestRange.minimum
    || regionNarrativePacks.coverage.taskTemplateSeedCount !== gameBrief.scale.taskTemplateRange.minimum) {
    fail('RegionNarrativePacks身份、上游或任务保底供给无效')
  }
  await assertOwnHash(regionNarrativePacks as unknown as Record<string, unknown>, 'regionNarrativePacksHash', 'RegionNarrativePacks')
  const expectedSources = buildQuestSources({ mainlineThread, significantThreads, regionNarrativePacks })
  if (canonicalProductProductionJsonV2(context.questSources) !== canonicalProductProductionJsonV2(expectedSources)) {
    fail('questSources不是上游故事与地区种子的确定性投影')
  }
}

async function loadQuestSkeletonsInput(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
}): Promise<TextOpenWorldQuestSkeletonsInputContextV1> {
  const [production, build, rows] = await Promise.all([
    db.productProductions.get(input.productionId),
    db.productBuilds.get(input.buildId),
    readAcceptedBuildArtifacts({ scope: input.scope, buildId: input.buildId }),
  ])
  if (!production || production.productType !== 'text-open-world'
    || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) {
    fail('Production不存在、跨Work或不是文字开放世界')
  }
  if (!build || build.productionId !== production.id
    || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) {
    fail('Build不属于当前Production/Work')
  }
  const keys = [
    'text-open-world.game-brief', 'text-open-world.experience-contract',
    'text-open-world.gameplay-ruleset-skeleton', 'text-open-world.mainline-thread',
    'text-open-world.significant-threads', 'text-open-world.region-narrative-packs',
  ] as const
  const rowsByKey = Object.fromEntries(keys.map(key => [key, uniqueAcceptedArtifact(rows, key)])) as Record<typeof keys[number], ProductBuildArtifactRecordV1>
  const gameBrief = parseArtifact<TextOpenWorldGameBriefV1>(rowsByKey['text-open-world.game-brief'], 'text-open-world.game-brief')
  const experienceContract = parseArtifact<TextOpenWorldExperienceContractV1>(rowsByKey['text-open-world.experience-contract'], 'text-open-world.experience-contract')
  const gameplayRuleset = parseArtifact<TextOpenWorldGameplayRulesetSkeletonV1>(rowsByKey['text-open-world.gameplay-ruleset-skeleton'], 'text-open-world.gameplay-ruleset-skeleton')
  const mainlineThread = parseArtifact<TextOpenWorldMainlineThreadV1>(rowsByKey['text-open-world.mainline-thread'], 'text-open-world.mainline-thread')
  const significantThreads = parseArtifact<TextOpenWorldSignificantThreadsV1>(rowsByKey['text-open-world.significant-threads'], 'text-open-world.significant-threads')
  const regionNarrativePacks = parseArtifact<TextOpenWorldRegionNarrativePacksV1>(rowsByKey['text-open-world.region-narrative-packs'], 'text-open-world.region-narrative-packs')
  const payloads = { gameBrief, experienceContract, gameplayRuleset, mainlineThread, significantThreads, regionNarrativePacks }
  const nameByKey = {
    'text-open-world.game-brief': 'gameBrief',
    'text-open-world.experience-contract': 'experienceContract',
    'text-open-world.gameplay-ruleset-skeleton': 'gameplayRuleset',
    'text-open-world.mainline-thread': 'mainlineThread',
    'text-open-world.significant-threads': 'significantThreads',
    'text-open-world.region-narrative-packs': 'regionNarrativePacks',
  } as const
  for (const key of keys) {
    if (await hashProductProductionValueV2(payloads[nameByKey[key]]) !== rowsByKey[key].contentHash) {
      fail(`QuestSkeleton上游Artifact行Hash不匹配:${key}`)
    }
  }
  const body: Omit<TextOpenWorldQuestSkeletonsInputContextV1, 'contextSelectionHash'> = {
    schema: 'storyforge.text-open-world-quest-skeletons-input',
    version: 1,
    productInstanceKey: production.productionKey,
    gameBrief,
    experienceContract,
    gameplayRuleset,
    mainlineThread,
    significantThreads,
    regionNarrativePacks,
    questSources: buildQuestSources({ mainlineThread, significantThreads, regionNarrativePacks }),
  }
  await validateUpstream(body)
  const context = { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('QuestSkeleton Context超过硬上限')
  return context
}

export async function readTextOpenWorldQuestSkeletonsInputContextV1(
  input: AssembleContextInput,
): Promise<string> {
  if (!input.scope || !Number.isSafeInteger(input.productProductionId)
    || !Number.isSafeInteger(input.productBuildId)) fail('Context读取缺少scope/production/build selector')
  return canonicalProductProductionJsonV2(await loadQuestSkeletonsInput({
    scope: input.scope,
    productionId: input.productProductionId!,
    buildId: input.productBuildId!,
  }))
}

async function parseContext(value: string): Promise<TextOpenWorldQuestSkeletonsInputContextV1> {
  let context: TextOpenWorldQuestSkeletonsInputContextV1
  try { context = JSON.parse(value) as TextOpenWorldQuestSkeletonsInputContextV1 }
  catch { return fail('Context JSON损坏') }
  if (context.schema !== 'storyforge.text-open-world-quest-skeletons-input' || context.version !== 1
    || context.productInstanceKey !== context.gameBrief.productInstanceKey) fail('Context身份无效')
  const { contextSelectionHash, ...body } = context
  await validateUpstream(body)
  if (!isSha256Hash(contextSelectionHash)
    || await hashProductProductionValueV2(body) !== contextSelectionHash) fail('Context选择Hash不匹配')
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Context超过硬上限')
  return context
}

function requirementSignature(requirement: RequirementDraftV1): string {
  return canonicalProductProductionJsonV2({
    ...requirement,
    normalizedTitle: requirement.title.toLocaleLowerCase('zh-CN'),
    requestedTraits: [...requirement.requestedTraits].sort(),
  })
}

function parseRequirement(value: unknown, label: string): RequirementDraftV1 {
  const requirement = record(value, label)
  exactKeys(requirement, [
    'kind', 'title', 'description', 'requestedTraits', 'minimumCount', 'criticality',
  ], label)
  return {
    kind: enumValue(requirement.kind, REQUIREMENT_KINDS, `${label}.kind`),
    title: text(requirement.title, `${label}.title`, 200),
    description: text(requirement.description, `${label}.description`),
    requestedTraits: stringArray(requirement.requestedTraits, `${label}.requestedTraits`, 12, true),
    minimumCount: integer(requirement.minimumCount, `${label}.minimumCount`, 1, 20),
    criticality: enumValue(requirement.criticality, CRITICALITIES, `${label}.criticality`),
  }
}

function parseDraft(value: unknown, context: TextOpenWorldQuestSkeletonsInputContextV1): QuestSkeletonsDraftV1 {
  const root = record(value, 'draft')
  exactKeys(root, ['schema', 'version', 'quests'], 'draft')
  if (root.schema !== 'storyforge.text-open-world-quest-skeletons-draft' || root.version !== 1) {
    fail('draft schema/version无效')
  }
  if (!Array.isArray(root.quests) || root.quests.length !== context.questSources.length) {
    fail(`quests必须与${context.questSources.length}个上游来源一一对应`)
  }
  const semanticRequirements = new Map<string, string>()
  const quests = root.quests.map((item, questIndex) => {
    const quest = record(item, `quests[${questIndex}]`)
    exactKeys(quest, [
      'sourceKind', 'sourceNumber', 'title', 'premise', 'storyMotivation',
      'intendedPlayerExperience', 'timePolicy', 'expirationMinutes', 'stages',
    ], `quests[${questIndex}]`)
    const sourceKind = enumValue(quest.sourceKind, SOURCE_KINDS, `quests[${questIndex}].sourceKind`)
    const kindSources = context.questSources.filter(source => source.kind === sourceKind)
    const sourceNumber = integer(quest.sourceNumber, `quests[${questIndex}].sourceNumber`, 1, kindSources.length)
    const source = kindSources[sourceNumber - 1]!
    const timePolicy = enumValue(quest.timePolicy, ['waits', 'timed'] as const, `quests[${questIndex}].timePolicy`)
    const expirationMinutes = nullableInteger(quest.expirationMinutes, `quests[${questIndex}].expirationMinutes`, 60, 10_080)
    if ((source.type === 'mainline' || source.type === 'significant') && (timePolicy !== 'waits' || expirationMinutes !== null)) {
      fail(`受保护任务必须无限等待:${source.sourceKey}`)
    }
    if ((timePolicy === 'timed') !== (expirationMinutes !== null)) fail(`任务timePolicy与expirationMinutes不一致:${source.sourceKey}`)
    if (!Array.isArray(quest.stages) || quest.stages.length < 1 || quest.stages.length > 4) {
      fail(`quests[${questIndex}].stages必须有1到4项`)
    }
    let hasProtectedRequirement = false
    let hasImportantRequirement = false
    const stages = quest.stages.map((stageItem, stageIndex) => {
      const stage = record(stageItem, `quests[${questIndex}].stages[${stageIndex}]`)
      exactKeys(stage, ['title', 'purpose', 'completionIntent', 'objectives'], `quests[${questIndex}].stages[${stageIndex}]`)
      if (!Array.isArray(stage.objectives) || stage.objectives.length < 1 || stage.objectives.length > 5) {
        fail(`quests[${questIndex}].stages[${stageIndex}].objectives必须有1到5项`)
      }
      const objectives = stage.objectives.map((objectiveItem, objectiveIndex) => {
        const objective = record(objectiveItem, `objectives[${objectiveIndex}]`)
        exactKeys(objective, [
          'title', 'playerIntent', 'successDescription', 'optional', 'requirements',
        ], `objectives[${objectiveIndex}]`)
        if (!Array.isArray(objective.requirements) || objective.requirements.length < 1 || objective.requirements.length > 8) {
          fail(`objectives[${objectiveIndex}].requirements必须有1到8项`)
        }
        const requirements = objective.requirements.map((entry, requirementIndex) => (
          parseRequirement(entry, `objectives[${objectiveIndex}].requirements[${requirementIndex}]`)
        ))
        const requirementSignatures = requirements.map(requirementSignature)
        if (new Set(requirementSignatures).size !== requirementSignatures.length) {
          fail(`同一Objective不得重复声明完全相同的内容需求:${source.sourceKey}`)
        }
        for (const requirement of requirements) {
          if (requirement.criticality === 'protected') hasProtectedRequirement = true
          if (requirement.criticality === 'protected' || requirement.criticality === 'important') hasImportantRequirement = true
          const semanticKey = `${requirement.kind}\u0000${requirement.title.toLocaleLowerCase('zh-CN')}`
          const signature = requirementSignature(requirement)
          const prior = semanticRequirements.get(semanticKey)
          if (prior && prior !== signature) fail(`同名内容需求定义冲突:${requirement.kind}/${requirement.title}`)
          semanticRequirements.set(semanticKey, signature)
        }
        const playerIntent = enumValue(objective.playerIntent, OBJECTIVE_INTENTS, `objectives[${objectiveIndex}].playerIntent`)
        const kinds = new Set(requirements.map(requirement => requirement.kind))
        if (playerIntent === 'combat' && !kinds.has('enemy') && !kinds.has('encounter')) {
          fail(`战斗Objective必须提出enemy或encounter需求:${source.sourceKey}`)
        }
        return {
          title: text(objective.title, `objectives[${objectiveIndex}].title`, 200),
          playerIntent,
          successDescription: text(objective.successDescription, `objectives[${objectiveIndex}].successDescription`),
          optional: boolean(objective.optional, `objectives[${objectiveIndex}].optional`),
          requirements,
        }
      })
      if (objectives.every(objective => objective.optional)) fail(`每个Quest Stage至少有一个必做Objective:${source.sourceKey}`)
      return {
        title: text(stage.title, `stages[${stageIndex}].title`, 200),
        purpose: text(stage.purpose, `stages[${stageIndex}].purpose`),
        completionIntent: text(stage.completionIntent, `stages[${stageIndex}].completionIntent`),
        objectives,
      }
    })
    if (source.type === 'mainline' && !hasProtectedRequirement) fail(`主线任务必须提出至少一项protected内容需求:${source.sourceKey}`)
    if (source.type === 'significant' && !hasImportantRequirement) fail(`重要故事任务必须提出至少一项important内容需求:${source.sourceKey}`)
    return {
      sourceKind,
      sourceNumber,
      title: text(quest.title, `quests[${questIndex}].title`, 200),
      premise: text(quest.premise, `quests[${questIndex}].premise`),
      storyMotivation: text(quest.storyMotivation, `quests[${questIndex}].storyMotivation`),
      intendedPlayerExperience: text(quest.intendedPlayerExperience, `quests[${questIndex}].intendedPlayerExperience`),
      timePolicy,
      expirationMinutes,
      stages,
    }
  })
  const sourceSignatures = quests.map(quest => `${quest.sourceKind}:${quest.sourceNumber}`)
  if (new Set(sourceSignatures).size !== context.questSources.length) fail('每个Quest Source必须且只能生成一个骨架')
  for (const source of context.questSources) {
    const kindOrder = context.questSources.filter(candidate => candidate.kind === source.kind).findIndex(candidate => candidate.sourceKey === source.sourceKey) + 1
    if (!sourceSignatures.includes(`${source.kind}:${kindOrder}`)) fail(`Quest Source未覆盖:${source.sourceKey}`)
  }
  return { quests }
}

function sourceForDraft(
  quest: QuestSkeletonsDraftV1['quests'][number],
  context: TextOpenWorldQuestSkeletonsInputContextV1,
): QuestSourceV1 {
  return context.questSources.filter(source => source.kind === quest.sourceKind)[quest.sourceNumber - 1]!
}

function questKey(source: QuestSourceV1): string {
  const prefix = source.type === 'mainline' ? 'quest.mainline'
    : source.type === 'significant' ? 'quest.significant'
      : source.type === 'ordinary' ? 'quest.ordinary' : 'quest.template'
  return `${prefix}.${String(source.sourceOrder).padStart(3, '0')}`
}

function requirementOwnerTask(kind: TextOpenWorldContentRequirementKindV1): TextOpenWorldContentRequirementManifestV1['requirements'][number]['ownerTaskKey'] {
  if (kind === 'skill') return 'p8.catalog.progression'
  if (kind === 'enemy' || kind === 'encounter') return 'p8.catalog.encounters'
  if (kind === 'item' || kind === 'equipment' || kind === 'material' || kind === 'reward') return 'p8.catalog.items-rewards'
  if (kind === 'recipe' || kind === 'vendor') return 'p8.catalog.crafting-economy'
  if (kind === 'actor' || kind === 'faction') return 'p8.catalog.npc-runtime'
  if (kind === 'location-interaction') return 'p8.catalog.map-interactions'
  return 'p8f.quest-finalize'
}

async function createArtifacts(input: {
  context: TextOpenWorldQuestSkeletonsInputContextV1
  draft: QuestSkeletonsDraftV1
  createdAt: number
}): Promise<TextOpenWorldQuestSkeletonArtifactsV1> {
  const questRows: TextOpenWorldQuestSkeletonsV1['quests'] = []
  const stageRows: TextOpenWorldQuestSkeletonsV1['stages'] = []
  const objectiveRows: TextOpenWorldQuestSkeletonsV1['objectives'] = []
  type ManifestRequirement = TextOpenWorldContentRequirementManifestV1['requirements'][number]
  const manifestRequirements: ManifestRequirement[] = []
  const requirementBySignature = new Map<string, ManifestRequirement>()
  const requirementKindCount = new Map<TextOpenWorldContentRequirementKindV1, number>()
  const addRequirement = (inputRequirement: Omit<ManifestRequirement, 'order'>): ManifestRequirement => {
    const row = { ...inputRequirement, order: manifestRequirements.length + 1 }
    manifestRequirements.push(row)
    return row
  }
  const addRegionalRequirement = (inputRequirement: {
    kind: 'actor' | 'faction' | 'location-interaction'
    title: string
    description: string
    traits: string[]
    criticality: 'ordinary' | 'important' | 'protected'
    reservationKey: string
    consumerKind: 'region-character' | 'region-faction' | 'location-plan'
    consumerKey: string
  }) => addRequirement({
    key: `content-requirement.region.${inputRequirement.kind}.${String(manifestRequirements.length + 1).padStart(3, '0')}`,
    kind: inputRequirement.kind,
    title: inputRequirement.title,
    description: inputRequirement.description,
    requestedTraits: inputRequirement.traits,
    minimumCount: 1,
    criticality: inputRequirement.criticality,
    sourceReservationKey: inputRequirement.reservationKey,
    consumerRefs: [{ kind: inputRequirement.consumerKind, consumerKey: inputRequirement.consumerKey }],
    ownerTaskKey: requirementOwnerTask(inputRequirement.kind),
    binding: { status: 'catalog-unbound', definitionKeys: [] },
  })
  input.context.regionNarrativePacks.packs.forEach(pack => {
    pack.characterRequirements.forEach(character => addRegionalRequirement({
      kind: 'actor',
      title: character.roleTitle,
      description: character.narrativeFunction,
      traits: [character.tier, character.runtimeMode, character.protectionRequirement, ...character.serviceNeeds],
      criticality: character.tier === 'important' ? 'protected' : character.tier === 'recurring' ? 'important' : 'ordinary',
      reservationKey: character.key,
      consumerKind: 'region-character',
      consumerKey: character.key,
    }))
    pack.factionRequirements.forEach(faction => addRegionalRequirement({
      kind: 'faction',
      title: faction.title,
      description: `${faction.publicGoal}；地区可见性：${faction.visiblePresence}`,
      traits: [faction.localResource],
      criticality: faction.significantThreadKeys.length ? 'important' : 'ordinary',
      reservationKey: faction.key,
      consumerKind: 'region-faction',
      consumerKey: faction.key,
    }))
    pack.locationPlans.forEach(plan => addRegionalRequirement({
      kind: 'location-interaction',
      title: `${plan.locationKey}的地区交互`,
      description: `${plan.dailyLife}；活动：${plan.activityPatterns.join('、')}`,
      traits: [...plan.requiredFunctions, ...plan.npcRoleNeeds],
      criticality: 'ordinary',
      reservationKey: plan.key,
      consumerKind: 'location-plan',
      consumerKey: plan.key,
    }))
  })
  input.draft.quests.forEach((quest, questIndex) => {
    const source = sourceForDraft(quest, input.context)
    const key = questKey(source)
    const lifecyclePlan = source.type === 'mainline' || source.type === 'significant'
      ? {
          lifecyclePolicy: 'protected-wait' as const,
          timePolicy: 'waits' as const,
          expirationMinutes: null,
          abandonable: false,
          mayFailPermanently: false,
          repeatable: false,
          instantiationPolicy: 'session-start' as const,
          pressureWhileAbsent: 'none' as const,
        }
      : source.type === 'ordinary'
        ? {
            lifecyclePolicy: 'abandon-restart' as const,
            timePolicy: quest.timePolicy,
            expirationMinutes: quest.expirationMinutes,
            abandonable: true,
            mayFailPermanently: true,
            repeatable: false,
            instantiationPolicy: 'session-start' as const,
            pressureWhileAbsent: quest.timePolicy === 'timed' ? 'deadline-only' as const : 'none' as const,
          }
        : {
            lifecyclePolicy: 'abandon-terminal' as const,
            timePolicy: quest.timePolicy,
            expirationMinutes: quest.expirationMinutes,
            abandonable: true,
            mayFailPermanently: true,
            repeatable: true,
            instantiationPolicy: 'director' as const,
            pressureWhileAbsent: quest.timePolicy === 'timed' ? 'deadline-only' as const : 'none' as const,
          }
    const sourceStageRows: TextOpenWorldQuestSkeletonsV1['stages'] = []
    quest.stages.forEach((stage, stageIndex) => {
      const stageKey = `${key}.stage.${String(stageIndex + 1).padStart(3, '0')}`
      const sourceObjectiveRows: TextOpenWorldQuestSkeletonsV1['objectives'] = []
      stage.objectives.forEach((objective, objectiveIndex) => {
        const objectiveKey = `${stageKey}.objective.${String(objectiveIndex + 1).padStart(3, '0')}`
        const requirementKeys = objective.requirements.map(requirement => {
          const signature = requirementSignature(requirement)
          let manifest = requirementBySignature.get(signature)
          if (!manifest) {
            const next = (requirementKindCount.get(requirement.kind) ?? 0) + 1
            requirementKindCount.set(requirement.kind, next)
            manifest = addRequirement({
              key: `content-requirement.${requirement.kind}.${String(next).padStart(3, '0')}`,
              kind: requirement.kind,
              title: requirement.title,
              description: requirement.description,
              requestedTraits: [...requirement.requestedTraits].sort(),
              minimumCount: requirement.minimumCount,
              criticality: requirement.criticality,
              sourceReservationKey: null,
              consumerRefs: [],
              ownerTaskKey: requirementOwnerTask(requirement.kind),
              binding: { status: 'catalog-unbound', definitionKeys: [] },
            })
            requirementBySignature.set(signature, manifest)
          }
          manifest.consumerRefs.push({ kind: 'quest-objective', consumerKey: objectiveKey })
          return manifest.key
        })
        const row = {
          key: objectiveKey,
          questKey: key,
          stageKey,
          order: objectiveIndex + 1,
          title: objective.title,
          playerIntent: objective.playerIntent,
          successDescription: objective.successDescription,
          optional: objective.optional,
          requirementKeys,
          runtimeBinding: { status: 'runtime-unbound' as const, actionKeys: [] as [] },
        }
        sourceObjectiveRows.push(row)
        objectiveRows.push(row)
      })
      const row = {
        key: stageKey,
        questKey: key,
        order: stageIndex + 1,
        previousStageKey: stageIndex === 0 ? null : `${key}.stage.${String(stageIndex).padStart(3, '0')}`,
        nextStageKey: stageIndex === quest.stages.length - 1 ? null : `${key}.stage.${String(stageIndex + 2).padStart(3, '0')}`,
        title: stage.title,
        purpose: stage.purpose,
        completionIntent: stage.completionIntent,
        objectiveKeys: sourceObjectiveRows.map(objective => objective.key),
        safeWaitBefore: lifecyclePlan.timePolicy === 'waits',
        safeWaitAfter: lifecyclePlan.timePolicy === 'waits',
        runtimeBinding: {
          status: 'runtime-unbound' as const,
          completionConditionKeys: [] as [],
          completionActionKey: null,
        },
      }
      sourceStageRows.push(row)
      stageRows.push(row)
    })
    questRows.push({
      key,
      order: questIndex + 1,
      type: source.type,
      source: { kind: source.kind, sourceKey: source.sourceKey, sourceOrder: source.sourceOrder },
      owner: { kind: source.ownerKind, semanticKey: source.ownerSemanticKey },
      storylineKey: source.storylineKey,
      title: quest.title,
      premise: quest.premise,
      storyMotivation: quest.storyMotivation,
      intendedPlayerExperience: quest.intendedPlayerExperience,
      regionKeys: source.regionKeys,
      locationKeys: source.locationKeys,
      stageKeys: sourceStageRows.map(stage => stage.key),
      estimatedMinutes: source.estimatedMinutes,
      lifecyclePlan,
      entryPlan: { mode: 'explicit-action', arrivalAloneNeverStarts: true, prerequisiteRequirementKeys: [] },
      runtimeBinding: {
        status: 'runtime-unbound', questKey: null, prerequisiteConditionKeys: [], rewardContractKey: null, claimActionKey: null,
      },
    })
  })
  manifestRequirements.forEach(requirement => {
    requirement.consumerRefs.sort((left, right) => left.kind.localeCompare(right.kind) || left.consumerKey.localeCompare(right.consumerKey))
  })
  const questBasis = {
    gameBriefHash: input.context.gameBrief.gameBriefHash,
    experienceContractHash: input.context.experienceContract.experienceContractHash,
    gameplayRulesetHash: input.context.gameplayRuleset.gameplayRulesetHash,
    mainlineThreadHash: input.context.mainlineThread.mainlineThreadHash,
    significantThreadsHash: input.context.significantThreads.significantThreadsHash,
    regionNarrativePacksHash: input.context.regionNarrativePacks.regionNarrativePacksHash,
    contextSelectionHash: input.context.contextSelectionHash,
  }
  const questBody: Omit<TextOpenWorldQuestSkeletonsV1, 'questSkeletonsHash'> = {
    schema: 'storyforge.text-open-world-quest-skeletons',
    version: 1,
    productType: 'text-open-world',
    productInstanceKey: input.context.productInstanceKey,
    gameBriefHash: input.context.gameBrief.gameBriefHash,
    experienceContractHash: input.context.experienceContract.experienceContractHash,
    gameplayRulesetHash: input.context.gameplayRuleset.gameplayRulesetHash,
    mainlineThreadHash: input.context.mainlineThread.mainlineThreadHash,
    significantThreadsHash: input.context.significantThreads.significantThreadsHash,
    regionNarrativePacksHash: input.context.regionNarrativePacks.regionNarrativePacksHash,
    quests: questRows,
    stages: stageRows,
    objectives: objectiveRows,
    coverage: {
      mainlineStageKeys: input.context.mainlineThread.stages.map(stage => stage.key),
      significantStageKeys: input.context.significantThreads.stages.map(stage => stage.key),
      ordinarySeedKeys: input.context.regionNarrativePacks.packs.flatMap(pack => pack.ordinaryQuestSeeds.map(seed => seed.key)),
      templateSeedKeys: input.context.regionNarrativePacks.packs.flatMap(pack => pack.taskTemplateSeeds.map(seed => seed.key)),
      uncoveredSourceKeys: [],
      totalQuestCount: questRows.length,
      protectedQuestCount: questRows.filter(quest => quest.lifecyclePlan.lifecyclePolicy === 'protected-wait').length,
      ordinaryQuestCount: questRows.filter(quest => quest.type === 'ordinary').length,
      templateQuestCount: questRows.filter(quest => quest.type === 'template').length,
      totalEstimatedMinutes: questRows.reduce((sum, quest) => sum + quest.estimatedMinutes, 0),
    },
    governance: {
      sourceCoverage: 'one-skeleton-per-source',
      noPrematureCatalogReferences: true,
      mainlineAndSignificantProtected: true,
      arrivalNeverSoleTrigger: true,
      allRuntimeBindingsUnbound: true,
    },
    basisHash: await hashProductProductionValueV2(questBasis),
    createdAt: input.createdAt,
  }
  const questSkeletons = { ...questBody, questSkeletonsHash: await hashProductProductionValueV2(questBody) }
  const questObjectiveKeys = objectiveRows.map(objective => objective.key)
  const regionCharacterKeys = input.context.regionNarrativePacks.packs.flatMap(pack => pack.characterRequirements.map(item => item.key))
  const regionFactionKeys = input.context.regionNarrativePacks.packs.flatMap(pack => pack.factionRequirements.map(item => item.key))
  const locationPlanKeys = input.context.regionNarrativePacks.packs.flatMap(pack => pack.locationPlans.map(item => item.key))
  const kindCounts = Object.fromEntries(REQUIREMENT_KINDS.map(kind => [
    kind,
    manifestRequirements.filter(requirement => requirement.kind === kind).length,
  ]).filter(([, count]) => Number(count) > 0)) as Partial<Record<TextOpenWorldContentRequirementKindV1, number>>
  const manifestBody: Omit<TextOpenWorldContentRequirementManifestV1, 'contentRequirementManifestHash'> = {
    schema: 'storyforge.text-open-world-content-requirement-manifest',
    version: 1,
    productType: 'text-open-world',
    productInstanceKey: input.context.productInstanceKey,
    questSkeletonsHash: questSkeletons.questSkeletonsHash,
    regionNarrativePacksHash: input.context.regionNarrativePacks.regionNarrativePacksHash,
    requirements: manifestRequirements,
    coverage: {
      questObjectiveKeys,
      coveredQuestObjectiveKeys: [...new Set(manifestRequirements.flatMap(requirement => requirement.consumerRefs
        .filter(ref => ref.kind === 'quest-objective').map(ref => ref.consumerKey)))].sort(),
      regionCharacterRequirementKeys: regionCharacterKeys,
      coveredRegionCharacterRequirementKeys: [...regionCharacterKeys],
      regionFactionRequirementKeys: regionFactionKeys,
      coveredRegionFactionRequirementKeys: [...regionFactionKeys],
      locationPlanKeys,
      coveredLocationPlanKeys: [...locationPlanKeys],
      requirementKindCounts: kindCounts,
      unresolvedRequirementKeys: manifestRequirements.map(requirement => requirement.key),
    },
    governance: {
      everyObjectiveHasRequirement: true,
      everyRegionalCatalogNeedCovered: true,
      duplicateSemanticsRejected: true,
      catalogsOwnDefinitions: true,
      questFinalizeOwnsBindings: true,
    },
    basisHash: await hashProductProductionValueV2({
      questSkeletonsHash: questSkeletons.questSkeletonsHash,
      regionNarrativePacksHash: input.context.regionNarrativePacks.regionNarrativePacksHash,
      requirementKeys: manifestRequirements.map(requirement => requirement.key),
    }),
    createdAt: input.createdAt,
  }
  return {
    questSkeletons,
    contentRequirementManifest: {
      ...manifestBody,
      contentRequirementManifestHash: await hashProductProductionValueV2(manifestBody),
    },
  }
}

function draftFromArtifacts(
  artifacts: TextOpenWorldQuestSkeletonArtifactsV1,
  context: TextOpenWorldQuestSkeletonsInputContextV1,
): unknown {
  const manifestByKey = new Map(artifacts.contentRequirementManifest.requirements.map(requirement => [requirement.key, requirement]))
  const stagesByQuest = new Map<string, TextOpenWorldQuestSkeletonsV1['stages']>()
  const objectivesByStage = new Map<string, TextOpenWorldQuestSkeletonsV1['objectives']>()
  artifacts.questSkeletons.stages.forEach(stage => {
    const rows = stagesByQuest.get(stage.questKey) ?? []
    rows.push(stage)
    stagesByQuest.set(stage.questKey, rows)
  })
  artifacts.questSkeletons.objectives.forEach(objective => {
    const rows = objectivesByStage.get(objective.stageKey) ?? []
    rows.push(objective)
    objectivesByStage.set(objective.stageKey, rows)
  })
  return {
    schema: 'storyforge.text-open-world-quest-skeletons-draft',
    version: 1,
    quests: artifacts.questSkeletons.quests.map(quest => {
      const sourceNumber = context.questSources.filter(source => source.kind === quest.source.kind)
        .findIndex(source => source.sourceKey === quest.source.sourceKey) + 1
      return {
        sourceKind: quest.source.kind,
        sourceNumber,
        title: quest.title,
        premise: quest.premise,
        storyMotivation: quest.storyMotivation,
        intendedPlayerExperience: quest.intendedPlayerExperience,
        timePolicy: quest.lifecyclePlan.timePolicy,
        expirationMinutes: quest.lifecyclePlan.expirationMinutes,
        stages: (stagesByQuest.get(quest.key) ?? []).sort((a, b) => a.order - b.order).map(stage => ({
          title: stage.title,
          purpose: stage.purpose,
          completionIntent: stage.completionIntent,
          objectives: (objectivesByStage.get(stage.key) ?? []).sort((a, b) => a.order - b.order).map(objective => ({
            title: objective.title,
            playerIntent: objective.playerIntent,
            successDescription: objective.successDescription,
            optional: objective.optional,
            requirements: objective.requirementKeys.map(key => {
              const requirement = manifestByKey.get(key) ?? fail(`Objective引用未知Requirement:${key}`)
              if (requirement.sourceReservationKey !== null) fail(`Objective不得直接引用地区预留需求:${key}`)
              return {
                kind: requirement.kind,
                title: requirement.title,
                description: requirement.description,
                requestedTraits: requirement.requestedTraits,
                minimumCount: requirement.minimumCount,
                criticality: requirement.criticality,
              }
            }),
          })),
        })),
      }
    }),
  }
}

export async function validateTextOpenWorldQuestSkeletonArtifactsV1(input: {
  artifacts: TextOpenWorldQuestSkeletonArtifactsV1
  context: TextOpenWorldQuestSkeletonsInputContextV1
}): Promise<TextOpenWorldQuestSkeletonArtifactsV1> {
  if (input.artifacts.questSkeletons.schema !== 'storyforge.text-open-world-quest-skeletons'
    || input.artifacts.questSkeletons.version !== 1
    || !isSha256Hash(input.artifacts.questSkeletons.questSkeletonsHash)
    || input.artifacts.contentRequirementManifest.schema !== 'storyforge.text-open-world-content-requirement-manifest'
    || input.artifacts.contentRequirementManifest.version !== 1
    || !isSha256Hash(input.artifacts.contentRequirementManifest.contentRequirementManifestHash)) {
    fail('QuestSkeleton/ContentRequirement Artifact身份或Hash字段无效')
  }
  if (input.artifacts.questSkeletons.createdAt !== input.artifacts.contentRequirementManifest.createdAt) {
    fail('QuestSkeleton与ContentRequirement必须来自同一次执行')
  }
  timestamp(input.artifacts.questSkeletons.createdAt, 'createdAt')
  const context = await parseContext(canonicalProductProductionJsonV2(input.context))
  const draft = parseDraft(draftFromArtifacts(input.artifacts, context), context)
  const rebuilt = await createArtifacts({ context, draft, createdAt: input.artifacts.questSkeletons.createdAt })
  if (canonicalProductProductionJsonV2(rebuilt) !== canonicalProductProductionJsonV2(input.artifacts)) {
    fail('任务来源覆盖、生命周期、需求清单、稳定键或未绑定运行槽被篡改')
  }
  return structuredClone(input.artifacts)
}

function systemPrompt(context: TextOpenWorldQuestSkeletonsInputContextV1): string {
  return [
    '你是StoryForge文字开放世界Quest Architect。你把每个主线Stage、重要故事Stage、普通任务种子和地区任务模板各编译成一个任务骨架，只描述故事动机、玩家体验、阶段目的、Objective意图与所需内容，不生成正式Quest/Action/Condition/Effect/NPC/敌人/物品/奖励键。',
    `questSources共有${context.questSources.length}项。必须按sourceKind分别使用一基sourceNumber并且每项精确覆盖一次；不能合并、遗漏或新增任务来源。mainline-stage/significant-stage固定无限等待、不可放弃或永久失败；ordinary-seed可放弃并重接，template-seed由地区导演实例化；后两类可选择waits或timed，timed必须给60到10080分钟。`,
    '每个任务写1到4个Stage，每Stage写1到5个Objective且至少一个必做。Objective的playerIntent只能是dialogue/investigate/explore/combat/collect/craft/trade/choice/travel/interact；combat必须提出enemy或encounter需求。',
    '每个Objective必须提出1到8项内容需求。kind只能是actor/faction/enemy/encounter/item/equipment/material/skill/recipe/vendor/reward/action/location-interaction；用title、description、requestedTraits、minimumCount描述能力，不得写目录键或数值Effect。同kind同title若重复，定义必须完全一致，代码会合并消费者。',
    '每个mainline-stage任务至少有一项protected需求，每个significant-stage至少有一项important或protected需求，确保关键角色、线索、战斗或访问路径能由后序目录明确保护。ordinary/template通常使用ordinary需求。',
    '任务的标题、前提、故事动机和玩家体验必须与对应source一致，并将自然语言“目标”拆成玩家能完成的Objective，不要写成剧情摘要。抵达地点绝不是唯一启动条件；正式生命周期、奖励、条件、Action和目录绑定由代码与后序QuestFinalize完成。',
    '只输出一个JSON对象，字段必须精确为：',
    '{"schema":"storyforge.text-open-world-quest-skeletons-draft","version":1,"quests":[{"sourceKind":"mainline-stage","sourceNumber":1,"title":"...","premise":"...","storyMotivation":"...","intendedPlayerExperience":"...","timePolicy":"waits","expirationMinutes":null,"stages":[{"title":"...","purpose":"...","completionIntent":"...","objectives":[{"title":"...","playerIntent":"investigate","successDescription":"...","optional":false,"requirements":[{"kind":"actor","title":"...","description":"...","requestedTraits":["关键线索可重新获取"],"minimumCount":1,"criticality":"protected"}]}]}]}]}',
  ].join('\n')
}

async function defaultModelRunner(
  input: Parameters<TextOpenWorldQuestSkeletonsModelRunnerV1>[0],
): Promise<TextOpenWorldQuestSkeletonsModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId,
    requirementKey: input.requirementKey,
    category: input.category,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: `以下是已登记并验签的任务骨架生产输入：\n<quest-skeletons-input>\n${input.contextText}\n</quest-skeletons-input>` },
    ],
    maximumOutputTokens: input.maximumOutputTokens,
    signal: input.signal,
    result,
    responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

export function createTextOpenWorldQuestSkeletonsExecutorV1(options: {
  runModel?: TextOpenWorldQuestSkeletonsModelRunnerV1
  now?: () => number
} = {}): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultModelRunner
  const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p8.quest-skeletons' || execution.task.skillId !== SKILL_ID
      || execution.task.executionMode !== 'model') fail('executor只接受P8 QuestSkeleton任务')
    if (canonicalProductProductionJsonV2(execution.task.outputArtifactKeys) !== canonicalProductProductionJsonV2([
      'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest',
    ])) fail('P8 QuestSkeleton输出Artifact集合不精确')
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('QuestSkeleton需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!
    const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey)
    if (!binding) fail('QuestSkeleton缺少文本capability binding')
    const context = await parseContext(execution.contextText)
    const prompt = systemPrompt(context)
    const startedAt = performance.now()
    const response = await runModel({
      projectId: execution.scope.projectId,
      requirementKey,
      category: 'text-open-world.production.quest-skeletons',
      system: prompt,
      contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(32_000, execution.task.budgetReservation.outputTokens)),
      signal: execution.signal,
    })
    if (response.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
    const draft = parseDraft(parseProductionModelJsonObjectV1(response.output, 'text-open-world-quest-skeletons'), context)
    const artifacts = await validateTextOpenWorldQuestSkeletonArtifactsV1({
      artifacts: await createArtifacts({ context, draft, createdAt: timestamp(now(), 'createdAt') }),
      context,
    })
    return {
      artifacts: [
        {
          artifactKey: 'text-open-world.quest-skeletons',
          kind: 'text-open-world.quest-skeletons',
          payload: artifacts.questSkeletons,
          quality: {
            allSourcesCovered: true,
            storyMotivationPresent: true,
            protectedLifecycleValidated: true,
            noPrematureReferences: true,
          },
          rights: { regionNarrativePacksHash: context.regionNarrativePacks.regionNarrativePacksHash },
        },
        {
          artifactKey: 'text-open-world.content-requirement-manifest',
          kind: 'text-open-world.content-requirement-manifest',
          payload: artifacts.contentRequirementManifest,
          quality: {
            everyObjectiveCovered: true,
            everyRegionalNeedCovered: true,
            catalogOwnershipDeclared: true,
            allRequirementsUnbound: true,
          },
          rights: { questSkeletonsHash: artifacts.questSkeletons.questSkeletonsHash },
        },
      ],
      passedGateIds: [...execution.task.acceptanceGateIds],
      usage: {
        modelCalls: 1,
        inputTokens: response.usage?.inputTokens ?? estimateTokens(execution.contextText + prompt),
        outputTokens: response.usage?.outputTokens ?? estimateTokens(response.output),
        mediaCalls: 0,
        costUsd: null,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        storageBytes: 0,
      },
    } satisfies ProductProductionTaskExecutionResultV1
  }
}
