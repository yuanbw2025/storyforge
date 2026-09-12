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
  TextOpenWorldLocationFunctionV1,
  TextOpenWorldMapInteractionCatalogV1,
  TextOpenWorldQuestSkeletonsV1,
  TextOpenWorldRegionNarrativePacksV1,
  TextOpenWorldRegionSkeletonV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'

const SKILL_ID = 'text-open-world.production.map-interaction-catalog.v1'
const MAX_CONTEXT_CHARS = 260_000
type InteractionKindV1 = 'observe' | 'investigate' | 'explore' | 'service' | 'crafting'

interface QuestConsumerProjectionV1 {
  productInstanceKey: string
  questSkeletonsHash: string
  quests: Array<{
    key: string
    type: 'mainline' | 'significant' | 'ordinary' | 'template'
    regionKeys: string[]
    locationKeys: string[]
    arrivalAloneNeverStarts: true
  }>
  objectives: Array<{ key: string; questKey: string }>
}

interface InteractionDemandV1 {
  demandNumber: number
  sourceDemandKey: string
  requirementKey: string
  sourceReservationKey: string | null
  title: string
  description: string
  requestedTraits: string[]
  criticality: 'ordinary' | 'important' | 'protected'
  candidateLocationKeys: string[]
  candidateKinds: InteractionKindV1[]
  questConsumerKeys: string[]
}

export interface TextOpenWorldMapInteractionInputContextV1 {
  schema: 'storyforge.text-open-world-map-interaction-input'
  version: 1
  productInstanceKey: string
  regionSkeleton: TextOpenWorldRegionSkeletonV1
  regionNarrativePacks: TextOpenWorldRegionNarrativePacksV1
  questSkeletons: QuestConsumerProjectionV1
  contentRequirementManifest: TextOpenWorldContentRequirementManifestV1
  interactionDemands: InteractionDemandV1[]
  contextSelectionHash: string
}

export interface TextOpenWorldMapInteractionModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldMapInteractionModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  expectedCapabilityHash: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldMapInteractionModelExecutionV1>

interface CatalogDraftV1 {
  interactions: Array<{
    demandNumber: number
    title: string
    description: string
    playerPrompt: string
    kind: InteractionKindV1
    locationNumber: number
  }>
}

function fail(message: string): never { throw new Error(`[text-open-world-map-interaction] ${message}`) }
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

function candidateKinds(functions: TextOpenWorldLocationFunctionV1[]): InteractionKindV1[] {
  const result: InteractionKindV1[] = ['observe', 'explore']
  if (functions.includes('narrative') || functions.includes('exploration')) result.push('investigate')
  if (functions.includes('service')) result.push('service')
  if (functions.includes('crafting')) result.push('crafting')
  return [...new Set(result)]
}

function buildDemands(input: {
  regionSkeleton: TextOpenWorldRegionSkeletonV1
  packs: TextOpenWorldRegionNarrativePacksV1
  quests: QuestConsumerProjectionV1
  manifest: TextOpenWorldContentRequirementManifestV1
}): InteractionDemandV1[] {
  const demands: InteractionDemandV1[] = []
  input.manifest.requirements.filter(requirement => requirement.ownerTaskKey === 'p8.catalog.map-interactions').forEach(requirement => {
    if (requirement.kind !== 'location-interaction' || requirement.binding.status !== 'catalog-unbound'
      || requirement.binding.definitionKeys.length) fail(`地图交互目录收到非法需求:${requirement.key}`)
    const plan = input.packs.packs.flatMap(pack => pack.locationPlans).find(item => item.key === requirement.sourceReservationKey)
    const objectiveKeys = requirement.consumerRefs.filter(ref => ref.kind === 'quest-objective').map(ref => ref.consumerKey)
    const quests = objectiveKeys.map(key => questForObjective(input.quests, key))
    const candidateLocationKeys = plan ? [plan.locationKey]
      : [...new Set(quests.flatMap(quest => quest.locationKeys))]
    const fallbackLocations = candidateLocationKeys.length ? candidateLocationKeys : input.regionSkeleton.locations.map(location => location.key)
    for (let index = 0; index < requirement.minimumCount; index += 1) {
      const allFunctions = [...new Set(fallbackLocations.flatMap(key => input.regionSkeleton.locations.find(location => location.key === key)!.functions))]
      demands.push({
        demandNumber: demands.length + 1,
        sourceDemandKey: `${requirement.key}.${String(index + 1).padStart(3, '0')}`,
        requirementKey: requirement.key, sourceReservationKey: requirement.sourceReservationKey,
        title: requirement.minimumCount === 1 ? requirement.title : `${requirement.title} ${index + 1}`,
        description: requirement.description, requestedTraits: requirement.requestedTraits,
        criticality: requirement.criticality, candidateLocationKeys: fallbackLocations,
        candidateKinds: candidateKinds(allFunctions), questConsumerKeys: quests.map(quest => quest.key),
      })
    }
  })
  if (demands.length > 120) fail('地图交互需求超过单Build首版上限120')
  return demands
}

function unreachableLocations(regionSkeleton: TextOpenWorldRegionSkeletonV1): string[] {
  const adjacency = new Map(regionSkeleton.locations.map(location => [location.key, new Set<string>()]))
  regionSkeleton.edges.forEach(edge => {
    adjacency.get(edge.fromLocationKey)?.add(edge.toLocationKey)
    if (edge.bidirectional) adjacency.get(edge.toLocationKey)?.add(edge.fromLocationKey)
  })
  const visited = new Set<string>(); const pending = [regionSkeleton.initialLocationKey]
  while (pending.length) {
    const key = pending.shift()!
    if (visited.has(key)) continue
    visited.add(key); adjacency.get(key)?.forEach(next => { if (!visited.has(next)) pending.push(next) })
  }
  return regionSkeleton.locations.map(location => location.key).filter(key => !visited.has(key))
}

async function validateUpstream(context: Omit<TextOpenWorldMapInteractionInputContextV1, 'contextSelectionHash'>): Promise<void> {
  const { regionSkeleton, regionNarrativePacks, questSkeletons, contentRequirementManifest } = context
  for (const [value, hashKey, label] of [
    [regionSkeleton, 'regionSkeletonHash', 'RegionSkeleton'],
    [regionNarrativePacks, 'regionNarrativePacksHash', 'RegionNarrativePacks'],
    [contentRequirementManifest, 'contentRequirementManifestHash', 'Manifest'],
  ] as const) await assertOwnHash(value as unknown as Record<string, unknown>, hashKey, label)
  if ([regionSkeleton, regionNarrativePacks, questSkeletons, contentRequirementManifest]
    .some(value => value.productInstanceKey !== context.productInstanceKey)
    || regionNarrativePacks.regionSkeletonHash !== regionSkeleton.regionSkeletonHash
    || contentRequirementManifest.regionNarrativePacksHash !== regionNarrativePacks.regionNarrativePacksHash
    || contentRequirementManifest.questSkeletonsHash !== questSkeletons.questSkeletonsHash
    || regionSkeleton.governance.arrivalStoryTrigger !== 'never-critical-location-only'
    || questSkeletons.quests.some(quest => !quest.arrivalAloneNeverStarts)
    || unreachableLocations(regionSkeleton).length) fail('Map Interaction上游身份、引用、连通或提前到达边界无效')
  const demands = buildDemands({ regionSkeleton, packs: regionNarrativePacks, quests: questSkeletons, manifest: contentRequirementManifest })
  if (canonicalProductProductionJsonV2(demands) !== canonicalProductProductionJsonV2(context.interactionDemands)) fail('interactionDemands不是上游确定性投影')
}

async function loadContext(input: { scope: WorkspaceScope; productionId: number; buildId: number }): Promise<TextOpenWorldMapInteractionInputContextV1> {
  const [production, build, rows] = await Promise.all([
    db.productProductions.get(input.productionId), db.productBuilds.get(input.buildId), readAcceptedBuildArtifacts({ scope: input.scope, buildId: input.buildId }),
  ])
  if (!production || production.productType !== 'text-open-world'
    || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) fail('Production不存在、跨Work或类型错误')
  if (!build || build.productionId !== production.id
    || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) fail('Build不属于当前Production/Work')
  const keys = [
    'text-open-world.region-skeleton', 'text-open-world.region-narrative-packs',
    'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest',
  ] as const
  const rowsByKey = Object.fromEntries(keys.map(key => [key, unique(rows, key)])) as Record<typeof keys[number], ProductBuildArtifactRecordV1>
  const regionSkeleton = artifact<TextOpenWorldRegionSkeletonV1>(rowsByKey[keys[0]], keys[0])
  const regionNarrativePacks = artifact<TextOpenWorldRegionNarrativePacksV1>(rowsByKey[keys[1]], keys[1])
  const fullQuestSkeletons = artifact<TextOpenWorldQuestSkeletonsV1>(rowsByKey[keys[2]], keys[2])
  const contentRequirementManifest = artifact<TextOpenWorldContentRequirementManifestV1>(rowsByKey[keys[3]], keys[3])
  const payloads = [regionSkeleton, regionNarrativePacks, fullQuestSkeletons, contentRequirementManifest]
  for (let index = 0; index < keys.length; index += 1) if (await hashProductProductionValueV2(payloads[index]) !== rowsByKey[keys[index]].contentHash) fail(`Artifact行Hash不匹配:${keys[index]}`)
  await assertOwnHash(fullQuestSkeletons as unknown as Record<string, unknown>, 'questSkeletonsHash', 'QuestSkeletons')
  const questSkeletons: QuestConsumerProjectionV1 = {
    productInstanceKey: fullQuestSkeletons.productInstanceKey, questSkeletonsHash: fullQuestSkeletons.questSkeletonsHash,
    quests: fullQuestSkeletons.quests.map(quest => ({
      key: quest.key, type: quest.type, regionKeys: quest.regionKeys, locationKeys: quest.locationKeys,
      arrivalAloneNeverStarts: quest.entryPlan.arrivalAloneNeverStarts,
    })),
    objectives: fullQuestSkeletons.objectives.map(objective => ({ key: objective.key, questKey: objective.questKey })),
  }
  const interactionDemands = buildDemands({ regionSkeleton, packs: regionNarrativePacks, quests: questSkeletons, manifest: contentRequirementManifest })
  const body: Omit<TextOpenWorldMapInteractionInputContextV1, 'contextSelectionHash'> = {
    schema: 'storyforge.text-open-world-map-interaction-input', version: 1, productInstanceKey: production.productionKey,
    regionSkeleton, regionNarrativePacks, questSkeletons, contentRequirementManifest, interactionDemands,
  }
  await validateUpstream(body)
  const context = { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Map Interaction Context超过硬上限')
  return context
}

export async function readTextOpenWorldMapInteractionInputContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !Number.isSafeInteger(input.productProductionId) || !Number.isSafeInteger(input.productBuildId)) fail('Context读取缺少scope/production/build selector')
  return canonicalProductProductionJsonV2(await loadContext({ scope: input.scope, productionId: input.productProductionId!, buildId: input.productBuildId! }))
}

async function parseContext(value: string): Promise<TextOpenWorldMapInteractionInputContextV1> {
  let context: TextOpenWorldMapInteractionInputContextV1
  try { context = JSON.parse(value) as TextOpenWorldMapInteractionInputContextV1 } catch { return fail('Context JSON损坏') }
  if (context.schema !== 'storyforge.text-open-world-map-interaction-input' || context.version !== 1) fail('Context身份无效')
  const { contextSelectionHash, ...body } = context; await validateUpstream(body)
  if (!isSha256Hash(contextSelectionHash) || await hashProductProductionValueV2(body) !== contextSelectionHash) fail('Context选择Hash不匹配')
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Context超过硬上限')
  return context
}

function parseDraft(value: unknown, context: TextOpenWorldMapInteractionInputContextV1): CatalogDraftV1 {
  const root = record(value, 'draft'); exactKeys(root, ['schema', 'version', 'interactions'], 'draft')
  if (root.schema !== 'storyforge.text-open-world-map-interaction-draft' || root.version !== 1) fail('draft schema/version无效')
  if (!Array.isArray(root.interactions) || root.interactions.length !== context.interactionDemands.length) fail(`interactions必须与${context.interactionDemands.length}项需求一一对应`)
  const interactions = root.interactions.map((value, index) => {
    const row = record(value, `interactions[${index}]`); exactKeys(row, ['demandNumber', 'title', 'description', 'playerPrompt', 'kind', 'locationNumber'], `interactions[${index}]`)
    const demandNumber = integer(row.demandNumber, `interactions[${index}].demandNumber`, 1, context.interactionDemands.length)
    const demand = context.interactionDemands[demandNumber - 1]!
    return {
      demandNumber, title: text(row.title, `interactions[${index}].title`, 200), description: text(row.description, `interactions[${index}].description`),
      playerPrompt: text(row.playerPrompt, `interactions[${index}].playerPrompt`, 300),
      kind: enumValue(row.kind, demand.candidateKinds, `interactions[${index}].kind`),
      locationNumber: integer(row.locationNumber, `interactions[${index}].locationNumber`, 1, demand.candidateLocationKeys.length),
    }
  })
  if (interactions.some((interaction, index) => interaction.demandNumber !== index + 1)
    || new Set(interactions.map(interaction => interaction.title.toLocaleLowerCase('zh-CN'))).size !== interactions.length) fail('interactions必须按序覆盖且标题不得重复')
  return { interactions }
}

function mapLayout(regionSkeleton: TextOpenWorldRegionSkeletonV1): TextOpenWorldMapInteractionCatalogV1['mapLayout'] {
  const regionCount = regionSkeleton.regions.length
  const locationNodes = regionSkeleton.regions.flatMap((region, regionIndex) => {
    const locations = region.locationKeys.map(key => regionSkeleton.locations.find(location => location.key === key)!)
    const centerX = regionCount === 1 ? 500 : 100 + Math.round(regionIndex * 800 / (regionCount - 1))
    return locations.map((location, locationIndex) => ({
      locationKey: location.key,
      x: Math.max(40, Math.min(960, centerX + ((locationIndex % 3) - 1) * 55)),
      y: locations.length === 1 ? 350 : 90 + Math.round(locationIndex * 520 / (locations.length - 1)),
    }))
  })
  if (new Set(locationNodes.map(node => `${node.x}:${node.y}`)).size !== locationNodes.length) fail('程序地图节点坐标发生重叠')
  return { version: 1, coordinateSystem: 'normalized-1000', width: 1000, height: 700, source: 'deterministic-fallback', locationNodes }
}

async function createArtifact(input: { context: TextOpenWorldMapInteractionInputContextV1; draft: CatalogDraftV1; createdAt: number }): Promise<TextOpenWorldMapInteractionCatalogV1> {
  const interactions = input.draft.interactions.map((draft, index) => {
    const demand = input.context.interactionDemands[draft.demandNumber - 1]!
    const locationKey = demand.candidateLocationKeys[draft.locationNumber - 1]!
    const location = input.context.regionSkeleton.locations.find(item => item.key === locationKey)!
    return {
      key: `interaction.catalog.${String(index + 1).padStart(3, '0')}`, order: index + 1,
      sourceDemandKey: demand.sourceDemandKey, title: draft.title, description: draft.description, playerPrompt: draft.playerPrompt,
      kind: draft.kind, regionKey: location.regionKey, locationKey, requiredFunctions: location.functions,
      questConsumerKeys: demand.questConsumerKeys, fulfilledRequirementKeys: [demand.requirementKey],
      earlyArrivalSafe: true as const, startsQuestOnArrival: false as const,
      runtimeBinding: { status: 'runtime-unbound' as const, actionKey: null, sceneKey: null, conditionKeys: [] as [], effectKeys: [] as [], questKeys: [] as [] },
    }
  })
  const regions = input.context.regionSkeleton.regions.map(region => ({
    key: region.key, order: region.order, title: region.title, description: region.description, theme: region.theme,
    locationKeys: region.locationKeys, fastTravelPointKey: region.fastTravelPointKey,
    initialKnowledge: region.initialKnowledge, sourceRefs: region.sourceClaimKeys, presentationRefs: [] as [],
  }))
  const locations = input.context.regionSkeleton.locations.map(location => ({
    key: location.key, regionKey: location.regionKey, order: location.order, title: location.title,
    description: location.description, kind: location.kind, purpose: location.purpose, functions: location.functions,
    earlyArrivalDescription: location.earlyArrivalDescription, initialKnowledge: location.initialKnowledge,
    interactionKeys: interactions.filter(interaction => interaction.locationKey === location.key).map(interaction => interaction.key),
    sourceRefs: location.sourceClaimKeys, presentationRefs: [] as [],
  }))
  const edges = input.context.regionSkeleton.edges.map(edge => ({
    key: edge.key, fromLocationKey: edge.fromLocationKey, toLocationKey: edge.toLocationKey,
    bidirectional: true as const, travelMinutes: edge.travelMinutes, description: edge.description,
    riskProfile: edge.riskProfile, sourceRefs: edge.sourceClaimKeys,
    runtimeBinding: { status: 'runtime-unbound' as const, forwardActionKey: null, reverseActionKey: null, conditionKeys: [] as [], effectKeys: [] as [] },
  }))
  const fastTravelPoints = input.context.regionSkeleton.fastTravelPoints.map(point => ({
    key: point.key, regionKey: point.regionKey, locationKey: point.locationKey,
    unlockedByDefault: point.unlockedByDefault, unlockPolicy: point.unlockedByDefault ? 'initial' as const : 'first-visit' as const,
    canRespawn: true as const, runtimeBinding: { status: 'runtime-unbound' as const, unlockEffectKey: null },
  }))
  const interactionRequirements = input.context.contentRequirementManifest.requirements.filter(requirement => requirement.ownerTaskKey === 'p8.catalog.map-interactions' && requirement.kind === 'location-interaction').map(requirement => requirement.key)
  const protectedQuestKeys = input.context.questSkeletons.quests.filter(quest => quest.type === 'mainline' || quest.type === 'significant').map(quest => quest.key)
  const body: Omit<TextOpenWorldMapInteractionCatalogV1, 'mapInteractionCatalogHash'> = {
    schema: 'storyforge.text-open-world-map-interaction-catalog', version: 1, productType: 'text-open-world',
    productInstanceKey: input.context.productInstanceKey,
    regionSkeletonHash: input.context.regionSkeleton.regionSkeletonHash,
    regionNarrativePacksHash: input.context.regionNarrativePacks.regionNarrativePacksHash,
    questSkeletonsHash: input.context.questSkeletons.questSkeletonsHash,
    contentRequirementManifestHash: input.context.contentRequirementManifest.contentRequirementManifestHash,
    initialRegionKey: input.context.regionSkeleton.initialRegionKey, initialLocationKey: input.context.regionSkeleton.initialLocationKey,
    regions, locations, edges, fastTravelPoints, interactions, mapLayout: mapLayout(input.context.regionSkeleton),
    travelPolicy: {
      ordinaryTravelAdvancesWorldTime: true, ordinaryTravelMayBeInterrupted: false,
      fastTravelRequiresVisitedDestination: true, fastTravelAdvancesWorldTime: true, travelResourceConsumption: 'none',
    },
    coverage: {
      requiredRegionKeys: input.context.regionSkeleton.regions.map(region => region.key), coveredRegionKeys: regions.map(region => region.key),
      requiredLocationKeys: input.context.regionSkeleton.locations.map(location => location.key), coveredLocationKeys: locations.map(location => location.key),
      requiredEdgeKeys: input.context.regionSkeleton.edges.map(edge => edge.key), coveredEdgeKeys: edges.map(edge => edge.key),
      requiredFastTravelPointKeys: input.context.regionSkeleton.fastTravelPoints.map(point => point.key), coveredFastTravelPointKeys: fastTravelPoints.map(point => point.key),
      requiredLocationInteractionRequirementKeys: interactionRequirements,
      coveredLocationInteractionRequirementKeys: [...new Set(interactions.flatMap(interaction => interaction.fulfilledRequirementKeys))],
      protectedQuestKeys,
      protectedQuestKeysWithArrivalSafeInteractions: protectedQuestKeys.filter(questKey => interactions
        .filter(interaction => interaction.questConsumerKeys.includes(questKey))
        .every(interaction => interaction.earlyArrivalSafe && !interaction.startsQuestOnArrival)),
      unreachableLocationKeys: unreachableLocations(input.context.regionSkeleton) as [], uncoveredDemandKeys: [],
    },
    governance: {
      completeMapAtBuild: true, progressiveKnowledge: true, allLocationsConnected: true,
      everyRegionHasFastTravelPoint: true, arrivalNeverSoleCriticalTrigger: true, earlyArrivalAlwaysSafe: true,
      topologyOwner: 'deterministic-compiler', interactionSemanticsOwner: 'model-validated',
      allRuntimeBindingsUnbound: true, worldAndActionModulesReady: false,
    },
    basisHash: await hashProductProductionValueV2({
      regionSkeletonHash: input.context.regionSkeleton.regionSkeletonHash,
      manifestHash: input.context.contentRequirementManifest.contentRequirementManifestHash,
      contextSelectionHash: input.context.contextSelectionHash,
      demandKeys: input.context.interactionDemands.map(demand => demand.sourceDemandKey),
    }),
    createdAt: input.createdAt,
  }
  if (!same(body.coverage.requiredRegionKeys, body.coverage.coveredRegionKeys)
    || !same(body.coverage.requiredLocationKeys, body.coverage.coveredLocationKeys)
    || !same(body.coverage.requiredEdgeKeys, body.coverage.coveredEdgeKeys)
    || !same(body.coverage.requiredFastTravelPointKeys, body.coverage.coveredFastTravelPointKeys)
    || !same(body.coverage.requiredLocationInteractionRequirementKeys, body.coverage.coveredLocationInteractionRequirementKeys)
    || !same(body.coverage.protectedQuestKeys, body.coverage.protectedQuestKeysWithArrivalSafeInteractions)
    || body.coverage.unreachableLocationKeys.length
    || locations.some(location => !location.interactionKeys.length)) fail('地图、地点交互、连通、快旅或提前到达保护没有闭合')
  return { ...body, mapInteractionCatalogHash: await hashProductProductionValueV2(body) }
}

function draftFromArtifact(artifact: TextOpenWorldMapInteractionCatalogV1, context: TextOpenWorldMapInteractionInputContextV1): unknown {
  return {
    schema: 'storyforge.text-open-world-map-interaction-draft', version: 1,
    interactions: artifact.interactions.map(interaction => {
      const demand = context.interactionDemands[interaction.order - 1]!
      return {
        demandNumber: interaction.order, title: interaction.title, description: interaction.description,
        playerPrompt: interaction.playerPrompt, kind: interaction.kind,
        locationNumber: demand.candidateLocationKeys.indexOf(interaction.locationKey) + 1,
      }
    }),
  }
}

export async function validateTextOpenWorldMapInteractionCatalogV1(input: {
  artifact: TextOpenWorldMapInteractionCatalogV1
  context: TextOpenWorldMapInteractionInputContextV1
}): Promise<TextOpenWorldMapInteractionCatalogV1> {
  if (input.artifact.schema !== 'storyforge.text-open-world-map-interaction-catalog' || input.artifact.version !== 1
    || !isSha256Hash(input.artifact.mapInteractionCatalogHash)) fail('MapInteractionCatalog身份或Hash字段无效')
  integer(input.artifact.createdAt, 'createdAt', 0, Number.MAX_SAFE_INTEGER)
  const context = await parseContext(canonicalProductProductionJsonV2(input.context))
  const draft = parseDraft(draftFromArtifact(input.artifact, context), context)
  const rebuilt = await createArtifact({ context, draft, createdAt: input.artifact.createdAt })
  if (canonicalProductProductionJsonV2(rebuilt) !== canonicalProductProductionJsonV2(input.artifact)) fail('拓扑、坐标、交互、旅行、快旅或提前到达保护被篡改')
  return structuredClone(input.artifact)
}

export async function projectTextOpenWorldMapInteractionCatalogAuthorEditableDraftV1(input: {
  artifact: TextOpenWorldMapInteractionCatalogV1
  context: TextOpenWorldMapInteractionInputContextV1 | string
}): Promise<unknown> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const artifact = await validateTextOpenWorldMapInteractionCatalogV1({ artifact: input.artifact, context })
  return structuredClone(draftFromArtifact(artifact, context))
}

export async function rebuildTextOpenWorldMapInteractionCatalogFromAuthorEditableDraftV1(input: {
  baseArtifact: TextOpenWorldMapInteractionCatalogV1
  context: TextOpenWorldMapInteractionInputContextV1 | string
  draft: unknown
}): Promise<TextOpenWorldMapInteractionCatalogV1> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const baseArtifact = await validateTextOpenWorldMapInteractionCatalogV1({ artifact: input.baseArtifact, context })
  const artifact = await createArtifact({
    context,
    draft: parseDraft(input.draft, context),
    createdAt: baseArtifact.createdAt,
  })
  return validateTextOpenWorldMapInteractionCatalogV1({ artifact, context })
}

function systemPrompt(context: TextOpenWorldMapInteractionInputContextV1): string {
  return [
    '你是StoryForge文字开放世界Map Interaction Catalog Designer。地图拓扑、地点、道路、旅行、快旅、SVG坐标、提前到达和任务触发安全全部由代码冻结；你只把每项需求写成与地点生活和任务语境一致的可点击交互。',
    `interactions共${context.interactionDemands.length}项，必须按demandNumber顺序精确覆盖。kind和locationNumber只能从每项candidateKinds/candidateLocationKeys编号中选择。`,
    'playerPrompt写成玩家界面可直接点击或理解的短动作。不得新增地区/地点/道路，不得声明到达自动接取/推进任务，不得输出Action、Effect、Condition、Scene、QuestKey、坐标或媒资引用。',
    '只输出字段精确的JSON：',
    '{"schema":"storyforge.text-open-world-map-interaction-draft","version":1,"interactions":[{"demandNumber":1,"title":"...","description":"...","playerPrompt":"...","kind":"explore","locationNumber":1}]}',
  ].join('\n')
}

async function defaultModelRunner(input: Parameters<TextOpenWorldMapInteractionModelRunnerV1>[0]): Promise<TextOpenWorldMapInteractionModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId, requirementKey: input.requirementKey,
    expectedCapabilityHash: input.expectedCapabilityHash, category: input.category,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: `以下是已登记并验签的地图交互目录输入：\n<map-interaction-input>\n${input.contextText}\n</map-interaction-input>` }],
    maximumOutputTokens: input.maximumOutputTokens, signal: input.signal, result, responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

export function createTextOpenWorldMapInteractionCatalogExecutorV1(options: {
  runModel?: TextOpenWorldMapInteractionModelRunnerV1
  now?: () => number
} = {}): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultModelRunner; const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p8.catalog.map-interactions' || execution.task.skillId !== SKILL_ID || execution.task.executionMode !== 'model') fail('executor只接受P8 Map Interaction任务')
    if (canonicalProductProductionJsonV2(execution.task.outputArtifactKeys) !== canonicalProductProductionJsonV2(['text-open-world.map-interaction-catalog'])) fail('Map Interaction输出Artifact集合不精确')
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('Map Interaction需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!; const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey)
    if (!binding) fail('Map Interaction缺少文本capability binding')
    const context = await parseContext(execution.contextText); const prompt = systemPrompt(context); const startedAt = performance.now()
    const response = await runModel({
      projectId: execution.scope.projectId, requirementKey, expectedCapabilityHash: binding.bindingHash,
      category: 'text-open-world.production.map-interaction-catalog',
      system: prompt, contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(28_000, execution.task.budgetReservation.outputTokens)), signal: execution.signal,
    })
    if (response.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
    const draft = parseDraft(parseProductionModelJsonObjectV1(response.output, 'text-open-world-map-interaction'), context)
    const artifact = await validateTextOpenWorldMapInteractionCatalogV1({
      artifact: await createArtifact({ context, draft, createdAt: integer(now(), 'createdAt', 0, Number.MAX_SAFE_INTEGER) }), context,
    })
    return {
      artifacts: [{
        artifactKey: 'text-open-world.map-interaction-catalog', kind: 'text-open-world.map-interaction-catalog', payload: artifact,
        quality: { topologyPreserved: true, everyLocationInteractive: true, fastTravelCovered: true, protectedArrivalSafe: true, runtimeBindingsUnbound: true },
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
