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
  TextOpenWorldNpcRuntimeCatalogV1,
  TextOpenWorldQuestSkeletonsV1,
  TextOpenWorldRegionNarrativePacksV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1 } from './product-config'
import { validateTextOpenWorldGameplayRulesetSkeletonV1 } from './gameplay-ruleset'

const SKILL_ID = 'text-open-world.production.npc-runtime-catalog.v1'
const MAX_CONTEXT_CHARS = 300_000
const PERIOD_KEYS = ['period.dawn', 'period.day', 'period.evening', 'period.night'] as const

interface QuestConsumerProjectionV1 {
  productInstanceKey: string
  questSkeletonsHash: string
  quests: Array<{ key: string; type: 'mainline' | 'significant' | 'ordinary' | 'template'; regionKeys: string[]; locationKeys: string[] }>
  objectives: Array<{ key: string; questKey: string }>
}

interface CraftingVendorProjectionV1 {
  productInstanceKey: string
  craftingEconomyCatalogHash: string
  vendors: Array<{
    key: string
    title: string
    description: string
    regionKey: string
    locationKey: string
    actorRequirementKey: string
  }>
}

interface FactionDemandV1 {
  demandNumber: number
  sourceDemandKey: string
  fixedFactionKey: string | null
  requirementKey: string
  title: string
  description: string
  requestedTraits: string[]
  criticality: 'ordinary' | 'important' | 'protected'
}

interface ActorDemandV1 {
  demandNumber: number
  sourceDemandKey: string
  demandKind: 'content-requirement' | 'vendor-service'
  fixedActorKey: string | null
  requirementKey: string | null
  title: string
  description: string
  requestedTraits: string[]
  criticality: 'ordinary' | 'important' | 'protected'
  regionKey: string
  homeLocationKey: string
  tier: 'mainline' | 'significant' | 'resident'
  runtimeMode: 'agent-maintained' | 'rule-driven'
  protected: boolean
  serviceLabels: string[]
  questConsumerKeys: string[]
}

export interface TextOpenWorldNpcRuntimeInputContextV1 {
  schema: 'storyforge.text-open-world-npc-runtime-input'
  version: 1
  productInstanceKey: string
  gameplayRuleset: TextOpenWorldGameplayRulesetSkeletonV1
  regionNarrativePacks: TextOpenWorldRegionNarrativePacksV1
  questSkeletons: QuestConsumerProjectionV1
  contentRequirementManifest: TextOpenWorldContentRequirementManifestV1
  craftingEconomyCatalog: CraftingVendorProjectionV1
  factionDemands: FactionDemandV1[]
  actorDemands: ActorDemandV1[]
  contextSelectionHash: string
}

export interface TextOpenWorldNpcRuntimeModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldNpcRuntimeModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldNpcRuntimeModelExecutionV1>

interface CatalogDraftV1 {
  factions: Array<{
    demandNumber: number
    description: string
    publicGoal: string
    moralityMultiplier: -1 | 0 | 1
  }>
  actors: Array<{
    demandNumber: number
    name: string
    biography: string
    portrayal: string
    factionNumber: number
    scheduleActivities: string[]
  }>
  attitudeBands: Array<{
    attitude: 'bad' | 'neutral' | 'good'
    label: string
    greetingTone: string
  }>
}

function fail(message: string): never { throw new Error(`[text-open-world-npc-runtime] ${message}`) }
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
function stringArray(value: unknown, label: string, exactLength: number): string[] {
  if (!Array.isArray(value) || value.length !== exactLength) fail(`${label}必须精确包含${exactLength}项`)
  return value.map((item, index) => text(item, `${label}[${index}]`, 300))
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

function buildDemands(input: {
  packs: TextOpenWorldRegionNarrativePacksV1
  quests: QuestConsumerProjectionV1
  manifest: TextOpenWorldContentRequirementManifestV1
  crafting: CraftingVendorProjectionV1
}): { factionDemands: FactionDemandV1[]; actorDemands: ActorDemandV1[] } {
  const factionDemands: FactionDemandV1[] = []
  const actorDemands: ActorDemandV1[] = []
  const firstPack = input.packs.packs[0] ?? fail('RegionNarrativePacks为空')
  input.manifest.requirements.filter(requirement => requirement.ownerTaskKey === 'p8.catalog.npc-runtime').forEach(requirement => {
    if ((requirement.kind !== 'actor' && requirement.kind !== 'faction')
      || requirement.binding.status !== 'catalog-unbound' || requirement.binding.definitionKeys.length) fail(`NPC目录收到非法需求:${requirement.key}`)
    if (requirement.kind === 'faction') {
      for (let index = 0; index < requirement.minimumCount; index += 1) factionDemands.push({
        demandNumber: factionDemands.length + 1,
        sourceDemandKey: `${requirement.key}.${String(index + 1).padStart(3, '0')}`,
        fixedFactionKey: index === 0 ? requirement.sourceReservationKey : null,
        requirementKey: requirement.key, title: requirement.minimumCount === 1 ? requirement.title : `${requirement.title} ${index + 1}`,
        description: requirement.description, requestedTraits: requirement.requestedTraits, criticality: requirement.criticality,
      })
      return
    }
    const regionalCharacter = input.packs.packs.flatMap(pack => pack.characterRequirements.map(character => ({ pack, character })))
      .find(item => item.character.key === requirement.sourceReservationKey)
    const objectiveKeys = requirement.consumerRefs.filter(ref => ref.kind === 'quest-objective').map(ref => ref.consumerKey)
    const relatedQuests = objectiveKeys.map(key => questForObjective(input.quests, key))
    const primaryQuest = relatedQuests[0]
    const pack = regionalCharacter?.pack
      ?? input.packs.packs.find(item => item.regionKey === primaryQuest?.regionKeys[0])
      ?? firstPack
    const homeLocationKey = regionalCharacter?.character.homeLocationKey
      ?? primaryQuest?.locationKeys[0]
      ?? pack.locationPlans[0]?.locationKey
      ?? fail(`角色需求没有合法地点:${requirement.key}`)
    const mainlineConsumer = relatedQuests.some(quest => quest.type === 'mainline')
    const significantConsumer = relatedQuests.some(quest => quest.type === 'significant')
    const importantRegional = regionalCharacter?.character.runtimeMode === 'agent-maintained'
    const tier = mainlineConsumer ? 'mainline' as const
      : significantConsumer || importantRegional || requirement.criticality !== 'ordinary' ? 'significant' as const : 'resident' as const
    const runtimeMode = tier === 'mainline' || tier === 'significant' ? 'agent-maintained' as const : 'rule-driven' as const
    const serviceLabels = regionalCharacter?.character.serviceNeeds ?? []
    for (let index = 0; index < requirement.minimumCount; index += 1) actorDemands.push({
      demandNumber: actorDemands.length + 1,
      sourceDemandKey: `${requirement.key}.${String(index + 1).padStart(3, '0')}`,
      demandKind: 'content-requirement', fixedActorKey: index === 0 ? requirement.sourceReservationKey : null,
      requirementKey: requirement.key, title: requirement.minimumCount === 1 ? requirement.title : `${requirement.title} ${index + 1}`,
      description: requirement.description, requestedTraits: requirement.requestedTraits,
      criticality: requirement.criticality, regionKey: pack.regionKey, homeLocationKey,
      tier, runtimeMode, protected: runtimeMode === 'agent-maintained', serviceLabels,
      questConsumerKeys: relatedQuests.map(quest => quest.key),
    })
  })
  input.crafting.vendors.forEach(vendor => actorDemands.push({
    demandNumber: actorDemands.length + 1, sourceDemandKey: `vendor-service.${vendor.key}`,
    demandKind: 'vendor-service', fixedActorKey: vendor.actorRequirementKey, requirementKey: null,
    title: `${vendor.title}经营者`, description: vendor.description, requestedTraits: ['商人', '功能NPC', '服务连续性'],
    criticality: 'ordinary', regionKey: vendor.regionKey, homeLocationKey: vendor.locationKey,
    tier: 'resident', runtimeMode: 'rule-driven', protected: false, serviceLabels: [vendor.key], questConsumerKeys: [],
  }))
  const actorKeys = actorDemands.map((demand, index) => demand.fixedActorKey ?? `actor.catalog.${String(index + 1).padStart(3, '0')}`)
  if (new Set(actorKeys).size !== actorKeys.length) fail('Actor预留键发生冲突')
  const factionKeys = factionDemands.map((demand, index) => demand.fixedFactionKey ?? `faction.catalog.${String(index + 1).padStart(3, '0')}`)
  if (new Set(factionKeys).size !== factionKeys.length) fail('Faction预留键发生冲突')
  if (actorDemands.length > 120 || factionDemands.length > 60) fail('NPC或势力需求超过单Build首版上限')
  return { factionDemands, actorDemands }
}

async function validateUpstream(context: Omit<TextOpenWorldNpcRuntimeInputContextV1, 'contextSelectionHash'>): Promise<void> {
  const { gameplayRuleset, regionNarrativePacks, questSkeletons, contentRequirementManifest, craftingEconomyCatalog } = context
  await validateTextOpenWorldGameplayRulesetSkeletonV1({ artifact: gameplayRuleset })
  for (const [value, hashKey, label] of [
    [regionNarrativePacks, 'regionNarrativePacksHash', 'RegionNarrativePacks'],
    [contentRequirementManifest, 'contentRequirementManifestHash', 'Manifest'],
  ] as const) await assertOwnHash(value as unknown as Record<string, unknown>, hashKey, label)
  if ([gameplayRuleset, regionNarrativePacks, questSkeletons, contentRequirementManifest, craftingEconomyCatalog]
    .some(value => value.productInstanceKey !== context.productInstanceKey)
    || contentRequirementManifest.questSkeletonsHash !== questSkeletons.questSkeletonsHash
    || craftingEconomyCatalog.vendors.some(vendor => !vendor.actorRequirementKey)) fail('NPC Runtime上游身份、引用或交互边界无效')
  const demands = buildDemands({ packs: regionNarrativePacks, quests: questSkeletons, manifest: contentRequirementManifest, crafting: craftingEconomyCatalog })
  if (canonicalProductProductionJsonV2(demands.factionDemands) !== canonicalProductProductionJsonV2(context.factionDemands)
    || canonicalProductProductionJsonV2(demands.actorDemands) !== canonicalProductProductionJsonV2(context.actorDemands)) fail('actor/faction demands不是上游确定性投影')
}

async function loadContext(input: { scope: WorkspaceScope; productionId: number; buildId: number }): Promise<TextOpenWorldNpcRuntimeInputContextV1> {
  const [production, build, rows] = await Promise.all([
    db.productProductions.get(input.productionId), db.productBuilds.get(input.buildId), readAcceptedBuildArtifacts({ scope: input.scope, buildId: input.buildId }),
  ])
  if (!production || production.productType !== 'text-open-world'
    || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) fail('Production不存在、跨Work或类型错误')
  if (!build || build.productionId !== production.id
    || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) fail('Build不属于当前Production/Work')
  const keys = [
    'text-open-world.gameplay-ruleset-skeleton', 'text-open-world.region-narrative-packs',
    'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest', 'text-open-world.crafting-economy-catalog',
  ] as const
  const rowsByKey = Object.fromEntries(keys.map(key => [key, unique(rows, key)])) as Record<typeof keys[number], ProductBuildArtifactRecordV1>
  const gameplayRuleset = artifact<TextOpenWorldGameplayRulesetSkeletonV1>(rowsByKey[keys[0]], keys[0])
  const regionNarrativePacks = artifact<TextOpenWorldRegionNarrativePacksV1>(rowsByKey[keys[1]], keys[1])
  const fullQuestSkeletons = artifact<TextOpenWorldQuestSkeletonsV1>(rowsByKey[keys[2]], keys[2])
  const contentRequirementManifest = artifact<TextOpenWorldContentRequirementManifestV1>(rowsByKey[keys[3]], keys[3])
  const fullCrafting = artifact<TextOpenWorldCraftingEconomyCatalogV1>(rowsByKey[keys[4]], keys[4])
  const payloads = [gameplayRuleset, regionNarrativePacks, fullQuestSkeletons, contentRequirementManifest, fullCrafting]
  for (let index = 0; index < keys.length; index += 1) if (await hashProductProductionValueV2(payloads[index]) !== rowsByKey[keys[index]].contentHash) fail(`Artifact行Hash不匹配:${keys[index]}`)
  await assertOwnHash(fullQuestSkeletons as unknown as Record<string, unknown>, 'questSkeletonsHash', 'QuestSkeletons')
  await assertOwnHash(fullCrafting as unknown as Record<string, unknown>, 'craftingEconomyCatalogHash', 'CraftingEconomyCatalog')
  const questSkeletons: QuestConsumerProjectionV1 = {
    productInstanceKey: fullQuestSkeletons.productInstanceKey, questSkeletonsHash: fullQuestSkeletons.questSkeletonsHash,
    quests: fullQuestSkeletons.quests.map(quest => ({ key: quest.key, type: quest.type, regionKeys: quest.regionKeys, locationKeys: quest.locationKeys })),
    objectives: fullQuestSkeletons.objectives.map(objective => ({ key: objective.key, questKey: objective.questKey })),
  }
  const craftingEconomyCatalog: CraftingVendorProjectionV1 = {
    productInstanceKey: fullCrafting.productInstanceKey, craftingEconomyCatalogHash: fullCrafting.craftingEconomyCatalogHash,
    vendors: fullCrafting.vendors.map(vendor => ({
      key: vendor.key, title: vendor.title, description: vendor.description, regionKey: vendor.regionKey,
      locationKey: vendor.locationKey, actorRequirementKey: vendor.runtimeBinding.actorRequirementKey,
    })),
  }
  const demands = buildDemands({ packs: regionNarrativePacks, quests: questSkeletons, manifest: contentRequirementManifest, crafting: craftingEconomyCatalog })
  const body: Omit<TextOpenWorldNpcRuntimeInputContextV1, 'contextSelectionHash'> = {
    schema: 'storyforge.text-open-world-npc-runtime-input', version: 1, productInstanceKey: production.productionKey,
    gameplayRuleset, regionNarrativePacks, questSkeletons, contentRequirementManifest, craftingEconomyCatalog, ...demands,
  }
  await validateUpstream(body)
  const context = { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('NPC Runtime Context超过硬上限')
  return context
}

export async function readTextOpenWorldNpcRuntimeInputContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !Number.isSafeInteger(input.productProductionId) || !Number.isSafeInteger(input.productBuildId)) fail('Context读取缺少scope/production/build selector')
  return canonicalProductProductionJsonV2(await loadContext({ scope: input.scope, productionId: input.productProductionId!, buildId: input.productBuildId! }))
}

async function parseContext(value: string): Promise<TextOpenWorldNpcRuntimeInputContextV1> {
  let context: TextOpenWorldNpcRuntimeInputContextV1
  try { context = JSON.parse(value) as TextOpenWorldNpcRuntimeInputContextV1 } catch { return fail('Context JSON损坏') }
  if (context.schema !== 'storyforge.text-open-world-npc-runtime-input' || context.version !== 1) fail('Context身份无效')
  const { contextSelectionHash, ...body } = context; await validateUpstream(body)
  if (!isSha256Hash(contextSelectionHash) || await hashProductProductionValueV2(body) !== contextSelectionHash) fail('Context选择Hash不匹配')
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Context超过硬上限')
  return context
}

function parseDraft(value: unknown, context: TextOpenWorldNpcRuntimeInputContextV1): CatalogDraftV1 {
  const root = record(value, 'draft'); exactKeys(root, ['schema', 'version', 'factions', 'actors', 'attitudeBands'], 'draft')
  if (root.schema !== 'storyforge.text-open-world-npc-runtime-draft' || root.version !== 1) fail('draft schema/version无效')
  if (!Array.isArray(root.factions) || root.factions.length !== context.factionDemands.length) fail(`factions必须与${context.factionDemands.length}项需求一一对应`)
  const factions = root.factions.map((value, index) => {
    const row = record(value, `factions[${index}]`); exactKeys(row, ['demandNumber', 'description', 'publicGoal', 'moralityMultiplier'], `factions[${index}]`)
    return {
      demandNumber: integer(row.demandNumber, `factions[${index}].demandNumber`, 1, context.factionDemands.length),
      description: text(row.description, `factions[${index}].description`), publicGoal: text(row.publicGoal, `factions[${index}].publicGoal`),
      moralityMultiplier: integer(row.moralityMultiplier, `factions[${index}].moralityMultiplier`, -1, 1) as -1 | 0 | 1,
    }
  })
  if (factions.some((faction, index) => faction.demandNumber !== index + 1)) fail('factions必须按需求顺序精确覆盖')
  if (!Array.isArray(root.actors) || root.actors.length !== context.actorDemands.length) fail(`actors必须与${context.actorDemands.length}项需求一一对应`)
  const actors = root.actors.map((value, index) => {
    const row = record(value, `actors[${index}]`); exactKeys(row, ['demandNumber', 'name', 'biography', 'portrayal', 'factionNumber', 'scheduleActivities'], `actors[${index}]`)
    const demandNumber = integer(row.demandNumber, `actors[${index}].demandNumber`, 1, context.actorDemands.length)
    const demand = context.actorDemands[demandNumber - 1]!
    return {
      demandNumber, name: text(row.name, `actors[${index}].name`, 120), biography: text(row.biography, `actors[${index}].biography`),
      portrayal: text(row.portrayal, `actors[${index}].portrayal`), factionNumber: integer(row.factionNumber, `actors[${index}].factionNumber`, 0, context.factionDemands.length),
      scheduleActivities: stringArray(row.scheduleActivities, `actors[${index}].scheduleActivities`, demand.runtimeMode === 'rule-driven' ? 4 : 0),
    }
  })
  if (actors.some((actor, index) => actor.demandNumber !== index + 1) || new Set(actors.map(actor => actor.name.toLocaleLowerCase('zh-CN'))).size !== actors.length) fail('actors必须按序覆盖且姓名不得重复')
  if (!Array.isArray(root.attitudeBands) || root.attitudeBands.length !== 3) fail('attitudeBands必须精确包含三档')
  const attitudeBands = root.attitudeBands.map((value, index) => {
    const row = record(value, `attitudeBands[${index}]`); exactKeys(row, ['attitude', 'label', 'greetingTone'], `attitudeBands[${index}]`)
    return { attitude: enumValue(row.attitude, ['bad', 'neutral', 'good'] as const, `attitudeBands[${index}].attitude`), label: text(row.label, `attitudeBands[${index}].label`, 100), greetingTone: text(row.greetingTone, `attitudeBands[${index}].greetingTone`, 500) }
  })
  if (!same(attitudeBands.map(item => item.attitude), ['bad', 'neutral', 'good'])) fail('attitudeBands必须覆盖bad/neutral/good且不重复')
  return { factions, actors, attitudeBands }
}

function actorKey(demand: ActorDemandV1, index: number): string {
  return demand.fixedActorKey ?? `actor.catalog.${String(index).padStart(3, '0')}`
}
function factionKey(demand: FactionDemandV1, index: number): string {
  return demand.fixedFactionKey ?? `faction.catalog.${String(index).padStart(3, '0')}`
}
function serviceKey(actorKeyValue: string, label: string, index: number): string {
  return label.startsWith('vendor.catalog.') ? `service.${label}` : `service.${actorKeyValue}.${String(index).padStart(3, '0')}`
}

async function createArtifact(input: { context: TextOpenWorldNpcRuntimeInputContextV1; draft: CatalogDraftV1; createdAt: number }): Promise<TextOpenWorldNpcRuntimeCatalogV1> {
  const factions = input.draft.factions.map((draft, index) => {
    const demand = input.context.factionDemands[draft.demandNumber - 1]!
    return {
      key: factionKey(demand, index + 1), order: index + 1, sourceDemandKey: demand.sourceDemandKey,
      title: demand.title, description: draft.description, publicGoal: draft.publicGoal,
      moralityMultiplier: draft.moralityMultiplier, fulfilledRequirementKeys: [demand.requirementKey], sourceRefs: [demand.sourceDemandKey],
    }
  })
  const baseActors: TextOpenWorldNpcRuntimeCatalogV1['actors'] = input.draft.actors.map((draft, index) => {
    const demand = input.context.actorDemands[draft.demandNumber - 1]!
    const key = actorKey(demand, index + 1)
    const services = demand.serviceLabels.map((label, serviceIndex) => serviceKey(key, label, serviceIndex + 1))
    return {
      key, order: index + 1, sourceDemandKey: demand.sourceDemandKey, demandKind: demand.demandKind,
      tier: demand.tier, runtimeMode: demand.runtimeMode, name: draft.name, biography: draft.biography, portrayal: draft.portrayal,
      factionKey: draft.factionNumber === 0 ? null : factions[draft.factionNumber - 1]!.key,
      homeLocationKey: demand.homeLocationKey, regionKey: demand.regionKey, protected: demand.protected,
      mortalityPolicy: demand.protected ? 'protected' as const : 'mortal' as const,
      serviceKeys: services, scheduleKey: demand.runtimeMode === 'rule-driven' ? `schedule.${key}` : null,
      fulfilledRequirementKeys: demand.requirementKey ? [demand.requirementKey] : [], questConsumerKeys: demand.questConsumerKeys,
      sourceRefs: [demand.sourceDemandKey],
      runtimeBinding: { status: 'runtime-partial' as const, dialogueSceneKeys: [] as [], actionKeys: [] as [], presentationRefs: [] as [] },
    }
  })
  const replacementActors: TextOpenWorldNpcRuntimeCatalogV1['actors'] = []
  baseActors.filter(actor => !actor.protected && actor.serviceKeys.length).forEach(owner => {
    replacementActors.push({
      key: `actor.replacement.${String(replacementActors.length + 1).padStart(3, '0')}`,
      order: baseActors.length + replacementActors.length + 1, sourceDemandKey: `replacement.${owner.key}`,
      demandKind: 'service-replacement', tier: 'transient', runtimeMode: 'rule-driven',
      name: `${owner.name}的接替者`, biography: `在${owner.homeLocationKey}接管必要公共服务的普通居民。`,
      portrayal: '只承担服务连续性与简短日常回应，不继承原角色的独特故事内容。', factionKey: owner.factionKey,
      homeLocationKey: owner.homeLocationKey, regionKey: owner.regionKey, protected: false, mortalityPolicy: 'mortal',
      serviceKeys: [...owner.serviceKeys], scheduleKey: `schedule.actor.replacement.${String(replacementActors.length + 1).padStart(3, '0')}`,
      fulfilledRequirementKeys: [], questConsumerKeys: [], sourceRefs: [`replacement.${owner.key}`],
      runtimeBinding: { status: 'runtime-partial', dialogueSceneKeys: [], actionKeys: [], presentationRefs: [] },
    })
  })
  const actors = [...baseActors, ...replacementActors]
  const activityByActor = new Map(baseActors.map((actor, index) => [actor.key, input.draft.actors[index]!.scheduleActivities]))
  const schedules = actors.filter(actor => actor.scheduleKey !== null).map(actor => ({
    key: actor.scheduleKey!, actorKey: actor.key,
    entries: PERIOD_KEYS.map((timePeriodKey, index) => ({
      timePeriodKey, locationKey: actor.homeLocationKey,
      activity: activityByActor.get(actor.key)?.[index] ?? (index === 3 ? '休息并暂停对外服务。' : '维持所在地的日常公共服务。'),
      availableServiceKeys: index === 3 ? [] : [...actor.serviceKeys],
    })),
  }))
  const replacementByOwner = new Map(replacementActors.map(actor => [actor.sourceRefs[0]!.replace('replacement.', ''), actor]))
  const serviceContinuity = baseActors.flatMap(owner => owner.serviceKeys.map((service, index) => {
    const replacement = replacementByOwner.get(owner.key) ?? null
    return {
      key: `service-continuity.${owner.key}.${String(index + 1).padStart(3, '0')}`, ownerActorKey: owner.key, serviceKey: service,
      policy: replacement ? 'replace-on-owner-death' as const : 'disappear-on-owner-death' as const,
      replacementActorKey: replacement?.key ?? null, replacementServiceKey: replacement ? service : null,
    }
  }))
  const attitudeDraft = new Map(input.draft.attitudeBands.map(item => [item.attitude, item]))
  const calibration = DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1.relationships
  const attitudeBands: TextOpenWorldNpcRuntimeCatalogV1['relationshipPolicy']['attitudeBands'] = [
    { attitude: 'bad', label: attitudeDraft.get('bad')!.label, greetingTone: attitudeDraft.get('bad')!.greetingTone, buyPriceMultiplier: 1.2, sellPriceMultiplier: 0.8, optionalInteractionPolicy: 'may-refuse' },
    { attitude: 'neutral', label: attitudeDraft.get('neutral')!.label, greetingTone: attitudeDraft.get('neutral')!.greetingTone, buyPriceMultiplier: 1, sellPriceMultiplier: 1, optionalInteractionPolicy: 'available' },
    { attitude: 'good', label: attitudeDraft.get('good')!.label, greetingTone: attitudeDraft.get('good')!.greetingTone, buyPriceMultiplier: 0.9, sellPriceMultiplier: 1.1, optionalInteractionPolicy: 'available' },
  ]
  const actorRequirements = input.context.contentRequirementManifest.requirements.filter(requirement => requirement.ownerTaskKey === 'p8.catalog.npc-runtime' && requirement.kind === 'actor').map(requirement => requirement.key)
  const factionRequirements = input.context.contentRequirementManifest.requirements.filter(requirement => requirement.ownerTaskKey === 'p8.catalog.npc-runtime' && requirement.kind === 'faction').map(requirement => requirement.key)
  const vendorReservations = input.context.craftingEconomyCatalog.vendors.map(vendor => vendor.actorRequirementKey)
  const protectedActors = baseActors.filter(actor => actor.questConsumerKeys.some(questKey => {
    const quest = input.context.questSkeletons.quests.find(item => item.key === questKey)
    return quest?.type === 'mainline' || quest?.type === 'significant'
  })).map(actor => actor.key)
  const functionalMortalActors = baseActors.filter(actor => !actor.protected && actor.serviceKeys.length).map(actor => actor.key)
  const body: Omit<TextOpenWorldNpcRuntimeCatalogV1, 'npcRuntimeCatalogHash'> = {
    schema: 'storyforge.text-open-world-npc-runtime-catalog', version: 1, productType: 'text-open-world',
    productInstanceKey: input.context.productInstanceKey,
    gameplayRulesetHash: input.context.gameplayRuleset.gameplayRulesetHash,
    regionNarrativePacksHash: input.context.regionNarrativePacks.regionNarrativePacksHash,
    questSkeletonsHash: input.context.questSkeletons.questSkeletonsHash,
    contentRequirementManifestHash: input.context.contentRequirementManifest.contentRequirementManifestHash,
    craftingEconomyCatalogHash: input.context.craftingEconomyCatalog.craftingEconomyCatalogHash,
    factions, actors, schedules, serviceContinuity,
    relationshipPolicy: {
      morality: calibration.morality, factionAffinity: calibration.factionAffinity, attitude: calibration.attitude,
      unaffiliatedMoralityMultiplier: 0, attitudeBands,
      crimeScope: 'morality-affinity-prices-local-quests-only', storyModifiers: 'p8f-unbound',
    },
    coverage: {
      requiredActorRequirementKeys: actorRequirements,
      coveredActorRequirementKeys: [...new Set(baseActors.flatMap(actor => actor.fulfilledRequirementKeys))],
      requiredFactionRequirementKeys: factionRequirements,
      coveredFactionRequirementKeys: [...new Set(factions.flatMap(faction => faction.fulfilledRequirementKeys))],
      requiredVendorActorReservationKeys: vendorReservations,
      coveredVendorActorReservationKeys: baseActors.filter(actor => actor.demandKind === 'vendor-service').map(actor => actor.key),
      requiredRegionKeys: input.context.regionNarrativePacks.packs.map(pack => pack.regionKey),
      regionsWithResidentActors: [...new Set(baseActors.filter(actor => actor.tier === 'resident').map(actor => actor.regionKey))],
      protectedQuestActorKeys: protectedActors,
      protectedQuestActorKeysWithProtection: protectedActors.filter(key => baseActors.find(actor => actor.key === key)?.mortalityPolicy === 'protected'),
      functionalMortalActorKeys: functionalMortalActors,
      functionalMortalActorKeysWithReplacement: functionalMortalActors.filter(key => serviceContinuity.some(row => row.ownerActorKey === key && row.policy === 'replace-on-owner-death' && row.replacementActorKey)),
      uncoveredDemandKeys: [],
    },
    governance: {
      importantActors: 'agent-maintained', ordinaryActors: 'rule-driven', attitudes: 'bad-neutral-good',
      independentNpcAffinity: false, importantActorsProtected: true, ordinaryActorsMayDie: true,
      functionalServicesReplaceable: true, uniqueContentMayDisappear: true, mainlineCannotBeBlockedByRelationship: true,
      dialogueAndActionsDeferred: true, npcRuntimeModuleReady: false,
    },
    basisHash: await hashProductProductionValueV2({
      rulesetHash: input.context.gameplayRuleset.gameplayRulesetHash,
      manifestHash: input.context.contentRequirementManifest.contentRequirementManifestHash,
      craftingEconomyCatalogHash: input.context.craftingEconomyCatalog.craftingEconomyCatalogHash,
      contextSelectionHash: input.context.contextSelectionHash,
      factionDemandKeys: input.context.factionDemands.map(demand => demand.sourceDemandKey),
      actorDemandKeys: input.context.actorDemands.map(demand => demand.sourceDemandKey),
    }),
    createdAt: input.createdAt,
  }
  if (!same(body.coverage.requiredActorRequirementKeys, body.coverage.coveredActorRequirementKeys)
    || !same(body.coverage.requiredFactionRequirementKeys, body.coverage.coveredFactionRequirementKeys)
    || !same(body.coverage.requiredVendorActorReservationKeys, body.coverage.coveredVendorActorReservationKeys)
    || !same(body.coverage.requiredRegionKeys, body.coverage.regionsWithResidentActors)
    || !same(body.coverage.protectedQuestActorKeys, body.coverage.protectedQuestActorKeysWithProtection)
    || !same(body.coverage.functionalMortalActorKeys, body.coverage.functionalMortalActorKeysWithReplacement)) fail('角色/势力需求、地区居民、关键保护或服务连续性没有闭合')
  return { ...body, npcRuntimeCatalogHash: await hashProductProductionValueV2(body) }
}

function draftFromArtifact(artifact: TextOpenWorldNpcRuntimeCatalogV1): unknown {
  const baseActors = artifact.actors.filter(actor => actor.demandKind !== 'service-replacement')
  return {
    schema: 'storyforge.text-open-world-npc-runtime-draft', version: 1,
    factions: artifact.factions.map(faction => ({ demandNumber: faction.order, description: faction.description, publicGoal: faction.publicGoal, moralityMultiplier: faction.moralityMultiplier })),
    actors: baseActors.map(actor => ({
      demandNumber: actor.order, name: actor.name, biography: actor.biography, portrayal: actor.portrayal,
      factionNumber: actor.factionKey === null ? 0 : artifact.factions.findIndex(faction => faction.key === actor.factionKey) + 1,
      scheduleActivities: actor.runtimeMode === 'rule-driven'
        ? artifact.schedules.find(schedule => schedule.actorKey === actor.key)!.entries.map(entry => entry.activity) : [],
    })),
    attitudeBands: artifact.relationshipPolicy.attitudeBands.map(band => ({ attitude: band.attitude, label: band.label, greetingTone: band.greetingTone })),
  }
}

export async function validateTextOpenWorldNpcRuntimeCatalogV1(input: {
  artifact: TextOpenWorldNpcRuntimeCatalogV1
  context: TextOpenWorldNpcRuntimeInputContextV1
}): Promise<TextOpenWorldNpcRuntimeCatalogV1> {
  if (input.artifact.schema !== 'storyforge.text-open-world-npc-runtime-catalog' || input.artifact.version !== 1
    || !isSha256Hash(input.artifact.npcRuntimeCatalogHash)) fail('NpcRuntimeCatalog身份或Hash字段无效')
  integer(input.artifact.createdAt, 'createdAt', 0, Number.MAX_SAFE_INTEGER)
  const context = await parseContext(canonicalProductProductionJsonV2(input.context))
  const draft = parseDraft(draftFromArtifact(input.artifact), context)
  const rebuilt = await createArtifact({ context, draft, createdAt: input.artifact.createdAt })
  if (canonicalProductProductionJsonV2(rebuilt) !== canonicalProductProductionJsonV2(input.artifact)) fail('角色层级、保护、日程、关系或服务连续性被篡改')
  return structuredClone(input.artifact)
}

function systemPrompt(context: TextOpenWorldNpcRuntimeInputContextV1): string {
  return [
    '你是StoryForge文字开放世界NPC Runtime Catalog Designer。人物小传与演绎说明保持完整文本资产；代码负责角色层级、Agent/规则模式、保护、死亡、日程结构、服务替代、稳定键、关系阈值和运行绑定。',
    `factions共${context.factionDemands.length}项、actors共${context.actorDemands.length}项，必须按demandNumber顺序精确覆盖。factionNumber为0表示无阵营，否则从1开始引用factions。`,
    'agent-maintained角色的scheduleActivities必须为空；rule-driven角色必须依次填写清晨、白天、傍晚、夜晚四条简单活动。moralityMultiplier只能是-1、0、1，表示该势力如何看待玩家道德方向。',
    '只写姓名、小传、演绎、日常活动、势力目标和三档招呼语气。不得输出Actor/Faction/Service/Schedule Key、保护/死亡策略、Action、Scene、Condition、Effect、Quest绑定或数值阈值。',
    '只输出字段精确的JSON：',
    '{"schema":"storyforge.text-open-world-npc-runtime-draft","version":1,"factions":[{"demandNumber":1,"description":"...","publicGoal":"...","moralityMultiplier":0}],"actors":[{"demandNumber":1,"name":"...","biography":"...","portrayal":"...","factionNumber":0,"scheduleActivities":[]}],"attitudeBands":[{"attitude":"bad","label":"...","greetingTone":"..."},{"attitude":"neutral","label":"...","greetingTone":"..."},{"attitude":"good","label":"...","greetingTone":"..."}]}',
  ].join('\n')
}

async function defaultModelRunner(input: Parameters<TextOpenWorldNpcRuntimeModelRunnerV1>[0]): Promise<TextOpenWorldNpcRuntimeModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId, requirementKey: input.requirementKey, category: input.category,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: `以下是已登记并验签的NPC运行目录输入：\n<npc-runtime-input>\n${input.contextText}\n</npc-runtime-input>` }],
    maximumOutputTokens: input.maximumOutputTokens, signal: input.signal, result, responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

export function createTextOpenWorldNpcRuntimeCatalogExecutorV1(options: {
  runModel?: TextOpenWorldNpcRuntimeModelRunnerV1
  now?: () => number
} = {}): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultModelRunner; const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p8.catalog.npc-runtime' || execution.task.skillId !== SKILL_ID || execution.task.executionMode !== 'model') fail('executor只接受P8 NPC Runtime任务')
    if (canonicalProductProductionJsonV2(execution.task.outputArtifactKeys) !== canonicalProductProductionJsonV2(['text-open-world.npc-runtime-catalog'])) fail('NPC Runtime输出Artifact集合不精确')
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('NPC Runtime需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!; const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey)
    if (!binding) fail('NPC Runtime缺少文本capability binding')
    const context = await parseContext(execution.contextText); const prompt = systemPrompt(context); const startedAt = performance.now()
    const response = await runModel({
      projectId: execution.scope.projectId, requirementKey, category: 'text-open-world.production.npc-runtime-catalog',
      system: prompt, contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(32_000, execution.task.budgetReservation.outputTokens)), signal: execution.signal,
    })
    if (response.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
    const draft = parseDraft(parseProductionModelJsonObjectV1(response.output, 'text-open-world-npc-runtime'), context)
    const artifact = await validateTextOpenWorldNpcRuntimeCatalogV1({
      artifact: await createArtifact({ context, draft, createdAt: integer(now(), 'createdAt', 0, Number.MAX_SAFE_INTEGER) }), context,
    })
    return {
      artifacts: [{
        artifactKey: 'text-open-world.npc-runtime-catalog', kind: 'text-open-world.npc-runtime-catalog', payload: artifact,
        quality: { actorRequirementsCovered: true, factionRequirementsCovered: true, importantActorsProtected: true, ordinarySchedulesComplete: true, functionalServicesReplaceable: true },
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
