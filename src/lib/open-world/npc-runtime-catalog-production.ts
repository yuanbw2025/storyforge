import { captureTextOpenWorldTaskExecutionInputV1, assertTextOpenWorldBuildNewWorkV1 } from './source-admission'
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
  vendorIdentityContract?: 'canonical-vendor-owners-v1'
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
  expectedCapabilityHash: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldNpcRuntimeModelExecutionV1>

interface CatalogDraftV1 {
  factions: Array<{
    demandNumber: number
    reuseFactionDemandNumber?: number
    description: string
    publicGoal: string
    moralityMultiplier: -1 | 0 | 1
  }>
  actors: Array<{
    demandNumber: number
    reuseActorDemandNumber?: number
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
  if (context.vendorIdentityContract !== undefined && context.vendorIdentityContract !== 'canonical-vendor-owners-v1') fail('商店身份合同无效')
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
    vendorIdentityContract: 'canonical-vendor-owners-v1',
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

/** Current author candidates preserve fixed identities, full provenance,
 * home/region and all service roles; the compiler remains the identity gate. */
export const NPC_RUNTIME_REPAIR_SECTIONS_V1 = ['contract', 'factions', 'actors', 'vendors', 'locations', 'requirements'] as const
export type NpcRuntimeRepairSectionV1 = typeof NPC_RUNTIME_REPAIR_SECTIONS_V1[number]
export async function projectTextOpenWorldNpcRuntimeRepairCandidatesV1(input: {
  contextText: string
  section: NpcRuntimeRepairSectionV1
  page: number
  expectedContextSelectionHash?: string
}) {
  if (!NPC_RUNTIME_REPAIR_SECTIONS_V1.includes(input.section)
    || !Number.isSafeInteger(input.page) || input.page < 0) fail('修订候选分类或页码无效')
  const context = await parseContext(input.contextText)
  if (input.expectedContextSelectionHash !== undefined
    && input.expectedContextSelectionHash !== context.contextSelectionHash) fail('修订候选上下文已变化，请重新读取')
  const sections: Record<NpcRuntimeRepairSectionV1, unknown[]> = {
    contract: [{ productInstanceKey: context.productInstanceKey,
      draftVersion: context.vendorIdentityContract ? 3 : 2, vendorIdentityContract: context.vendorIdentityContract ?? null,
      gameplayRulesetHash: context.gameplayRuleset.gameplayRulesetHash, periodKeys: PERIOD_KEYS,
      actorCount: context.actorDemands.length, factionCount: context.factionDemands.length,
      vendorCount: context.craftingEconomyCatalog.vendors.length,
      numbering: '角色与势力按需求编号覆盖；factionNumber引用势力需求。固定内容身份不可合并；新合同商店岗位仅能绑定此前同地区同家园固定内容人物，不能减少同一需求最小人数。' }],
    factions: context.factionDemands,
    actors: context.actorDemands,
    vendors: context.craftingEconomyCatalog.vendors,
    locations: context.regionNarrativePacks.packs.flatMap(pack => pack.locationPlans.map(location => ({ regionKey: pack.regionKey, ...location }))),
    requirements: context.contentRequirementManifest.requirements,
  }
  const rows = sections[input.section], pageSize = 5
  if (input.page >= Math.max(1, Math.ceil(rows.length / pageSize))) fail('修订候选页码超出范围')
  return { contextSelectionHash: context.contextSelectionHash, section: input.section,
    page: input.page, pageSize, total: rows.length, rows: rows.slice(input.page * pageSize, (input.page + 1) * pageSize) }
}

function identityReuses(
  rows: unknown[],
  demands: Array<{ demandNumber: number; requirementKey: string | null }>,
  fixedKeys: Array<string | null>,
  field: 'reuseActorDemandNumber' | 'reuseFactionDemandNumber',
  version: number,
  vendorActors?: ActorDemandV1[],
): Map<number, number> {
  const reuses = new Map<number, number>()
  const label = field === 'reuseActorDemandNumber' ? '角色' : '势力'
  rows.forEach((value, index) => {
    const row = record(value, `${label}[${index}]`)
    if (row.demandNumber !== index + 1) fail(`${label}必须按需求顺序精确覆盖`)
    if (!Object.prototype.hasOwnProperty.call(row, field)) return
    if (version !== 2 && version !== 3) fail('身份复用需要draft version 2或3')
    exactKeys(row, ['demandNumber', field], `${label}复用`)
    const vendorRole = version === 3 && vendorActors?.[index]?.demandKind === 'vendor-service'
    if (fixedKeys[index] && !vendorRole) fail(`已预留${label}身份不得合并`)
    const target = integer(row[field], field, 1, index)
    if (!fixedKeys[target - 1] || !demands[target - 1]!.requirementKey) fail(`${label}只能复用此前已预留的同类身份`)
    if (vendorRole) {
      const source = vendorActors![index]!
      const owner = vendorActors![target - 1]!
      if (owner.demandKind !== 'content-requirement' || owner.regionKey !== source.regionKey
        || owner.homeLocationKey !== source.homeLocationKey) fail('商店岗位只能绑定同地区同家园的固定内容角色')
    }
    reuses.set(index + 1, target)
  })
  for (const target of new Set(reuses.values())) {
    const members = demands.filter(demand => demand.demandNumber === target || reuses.get(demand.demandNumber) === target)
    const countedMembers = version === 3 && vendorActors ? members.filter(demand => demand.requirementKey !== null) : members
    if (new Set(countedMembers.map(demand => demand.requirementKey)).size !== countedMembers.length) fail(`${label}复用不得降低同一需求的最小数量`)
  }
  return reuses
}

function parseDraft(value: unknown, context: TextOpenWorldNpcRuntimeInputContextV1): CatalogDraftV1 {
  const root = record(value, 'draft')
  const authorBound = Object.prototype.hasOwnProperty.call(root, 'authorContextSelectionHash')
  if (authorBound && root.authorContextSelectionHash !== context.contextSelectionHash) fail('作者修订上下文已变化，请重新读取候选')
  exactKeys(root, ['schema', 'version', 'factions', 'actors', 'attitudeBands', ...(authorBound ? ['authorContextSelectionHash'] : [])], 'draft')
  if (root.schema !== 'storyforge.text-open-world-npc-runtime-draft'
    || ![1, 2, 3].includes(Number(root.version)) || typeof root.version !== 'number') fail('draft schema/version无效')
  if (root.version === 3 && context.vendorIdentityContract !== 'canonical-vendor-owners-v1') fail('draft version 3需要新商店身份合同')
  if (!Array.isArray(root.factions) || root.factions.length !== context.factionDemands.length) fail(`factions必须与${context.factionDemands.length}项需求一一对应`)
  const factionRows = root.factions
  const factionReuses = identityReuses(factionRows, context.factionDemands, context.factionDemands.map(demand => demand.fixedFactionKey), 'reuseFactionDemandNumber', root.version)
  const factions = root.factions.map((value, index) => {
    const reuse = factionReuses.get(index + 1)
    const row = record(reuse ? factionRows[reuse - 1] : value, `factions[${index}]`); exactKeys(row, ['demandNumber', 'description', 'publicGoal', 'moralityMultiplier'], `factions[${index}]`)
    return {
      demandNumber: index + 1,
      ...(reuse ? { reuseFactionDemandNumber: reuse } : {}),
      description: text(row.description, `factions[${index}].description`), publicGoal: text(row.publicGoal, `factions[${index}].publicGoal`),
      moralityMultiplier: integer(row.moralityMultiplier, `factions[${index}].moralityMultiplier`, -1, 1) as -1 | 0 | 1,
    }
  })
  if (factions.some((faction, index) => faction.demandNumber !== index + 1)) fail('factions必须按需求顺序精确覆盖')
  if (!Array.isArray(root.actors) || root.actors.length !== context.actorDemands.length) fail(`actors必须与${context.actorDemands.length}项需求一一对应`)
  const actorRows = root.actors
  const actorReuses = identityReuses(actorRows, context.actorDemands, context.actorDemands.map(demand => demand.fixedActorKey), 'reuseActorDemandNumber', root.version,
    context.vendorIdentityContract ? context.actorDemands : undefined)
  const actors = root.actors.map((value, index) => {
    const reuse = actorReuses.get(index + 1)
    const primaryNumber = reuse ?? index + 1
    const row = record(reuse ? actorRows[reuse - 1] : value, `actors[${index}]`); exactKeys(row, ['demandNumber', 'name', 'biography', 'portrayal', 'factionNumber', 'scheduleActivities'], `actors[${index}]`)
    const maintained = context.actorDemands.some(demand => (demand.demandNumber === primaryNumber || actorReuses.get(demand.demandNumber) === primaryNumber) && demand.runtimeMode === 'agent-maintained')
    return {
      demandNumber: index + 1, ...(reuse ? { reuseActorDemandNumber: reuse } : {}),
      name: text(row.name, `actors[${index}].name`, 120), biography: text(row.biography, `actors[${index}].biography`),
      portrayal: text(row.portrayal, `actors[${index}].portrayal`), factionNumber: integer(row.factionNumber, `actors[${index}].factionNumber`, 0, context.factionDemands.length),
      scheduleActivities: stringArray(row.scheduleActivities, `actors[${index}].scheduleActivities`, maintained ? 0 : 4),
    }
  })
  const distinctActors = actors.filter(actor => !actor.reuseActorDemandNumber)
  if (new Set(distinctActors.map(actor => actor.name.toLocaleLowerCase('zh-CN'))).size !== distinctActors.length) fail('actors必须按序覆盖且姓名不得重复')
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

/** Vendor reservations describe service roles; only a fresh, explicit identity
 * contract may resolve them through canonical actor provenance. */
export function resolveTextOpenWorldVendorActorV1(
  catalog: Pick<TextOpenWorldNpcRuntimeCatalogV1, 'actors' | 'vendorIdentityContract'>,
  vendor: { key: string; actorRequirementKey: string; regionKey: string; locationKey: string },
) {
  if (!catalog.vendorIdentityContract) return catalog.actors.find(actor => (
    actor.sourceDemandKey === vendor.actorRequirementKey || actor.key === vendor.actorRequirementKey
  )) ?? fail(`商店Actor预留未兑现:${vendor.key}`)
  if (catalog.vendorIdentityContract !== 'canonical-vendor-owners-v1') fail('商店身份合同无效')
  const matches = catalog.actors.filter(actor => actor.demandKind !== 'service-replacement'
    && actor.sourceRefs.includes(`vendor-service.${vendor.key}`))
  if (matches.length !== 1) fail(`商店岗位缺少唯一角色来源映射:${vendor.key}`)
  const actor = matches[0]!
  if (!actor.serviceKeys.includes(`service.${vendor.key}`)
    || actor.regionKey !== vendor.regionKey || actor.homeLocationKey !== vendor.locationKey) fail(`商店岗位的服务或地点不匹配:${vendor.key}`)
  return actor
}

export function resolveTextOpenWorldVendorServiceV1(
  catalog: Pick<TextOpenWorldNpcRuntimeCatalogV1, 'actors' | 'vendorIdentityContract' | 'serviceContinuity'>,
  vendor: { key: string; actorRequirementKey: string; regionKey: string; locationKey: string },
) {
  const actor = resolveTextOpenWorldVendorActorV1(catalog, vendor)
  if (!catalog.vendorIdentityContract) return { actor, replacement: null }
  const rules = catalog.serviceContinuity.filter(rule => rule.ownerActorKey === actor.key && rule.serviceKey === `service.${vendor.key}`)
  if (rules.length !== 1) fail(`商店缺少唯一服务连续性:${vendor.key}`)
  const rule = rules[0]!
  if (actor.protected) {
    if (rule.policy !== 'disappear-on-owner-death' || rule.replacementActorKey !== null || rule.replacementServiceKey !== null) fail(`受保护商店不得绑定替身:${vendor.key}`)
    return { actor, replacement: null }
  }
  const replacement = catalog.actors.find(row => row.key === rule.replacementActorKey)
  if (rule.policy !== 'replace-on-owner-death' || rule.replacementServiceKey !== rule.serviceKey
    || !replacement || replacement.demandKind !== 'service-replacement'
    || replacement.sourceRefs.length !== 1 || replacement.sourceRefs[0] !== `replacement.${actor.key}`
    || replacement.protected || replacement.mortalityPolicy !== 'mortal'
    || replacement.homeLocationKey !== actor.homeLocationKey || replacement.regionKey !== actor.regionKey
    || replacement.factionKey !== actor.factionKey || !replacement.serviceKeys.includes(rule.serviceKey)
    || replacement.fulfilledRequirementKeys.length || replacement.questConsumerKeys.length) fail(`商店死亡接替来源或身份不闭合:${vendor.key}`)
  return { actor, replacement }
}

async function createArtifact(input: { context: TextOpenWorldNpcRuntimeInputContextV1; draft: CatalogDraftV1; createdAt: number }): Promise<TextOpenWorldNpcRuntimeCatalogV1> {
  const factions = input.draft.factions.filter(draft => !draft.reuseFactionDemandNumber).map((draft, index) => {
    const demand = input.context.factionDemands[draft.demandNumber - 1]!
    const members = input.draft.factions.filter(row => row.demandNumber === draft.demandNumber || row.reuseFactionDemandNumber === draft.demandNumber)
      .map(row => input.context.factionDemands[row.demandNumber - 1]!)
    return {
      key: factionKey(demand, draft.demandNumber), order: index + 1, sourceDemandKey: demand.sourceDemandKey,
      title: demand.title, description: draft.description, publicGoal: draft.publicGoal,
      moralityMultiplier: draft.moralityMultiplier, fulfilledRequirementKeys: members.map(member => member.requirementKey), sourceRefs: members.map(member => member.sourceDemandKey),
    }
  })
  const primaryActors = input.draft.actors.filter(draft => !draft.reuseActorDemandNumber)
  const baseActors: TextOpenWorldNpcRuntimeCatalogV1['actors'] = primaryActors.map((draft, index) => {
    const demand = input.context.actorDemands[draft.demandNumber - 1]!
    const members = input.draft.actors.filter(row => row.demandNumber === draft.demandNumber || row.reuseActorDemandNumber === draft.demandNumber)
      .map(row => input.context.actorDemands[row.demandNumber - 1]!)
    const tier = members.some(member => member.tier === 'mainline') ? 'mainline' : members.some(member => member.tier === 'significant') ? 'significant' : 'resident'
    const maintained = tier !== 'resident'
    const key = actorKey(demand, draft.demandNumber)
    const serviceLabels = members.length === 1 ? demand.serviceLabels : [...new Set(members.flatMap(member => member.serviceLabels))]
    const services = serviceLabels.map((label, serviceIndex) => serviceKey(key, label, serviceIndex + 1))
    return {
      key, order: index + 1, sourceDemandKey: demand.sourceDemandKey, demandKind: demand.demandKind,
      tier, runtimeMode: maintained ? 'agent-maintained' : 'rule-driven', name: draft.name, biography: draft.biography, portrayal: draft.portrayal,
      factionKey: draft.factionNumber === 0 ? null : factions.find(faction => faction.sourceRefs.includes(input.context.factionDemands[draft.factionNumber - 1]!.sourceDemandKey))!.key,
      homeLocationKey: demand.homeLocationKey, regionKey: demand.regionKey, protected: maintained,
      mortalityPolicy: maintained ? 'protected' as const : 'mortal' as const,
      serviceKeys: services, scheduleKey: maintained ? null : `schedule.${key}`,
      fulfilledRequirementKeys: members.flatMap(member => member.requirementKey ? [member.requirementKey] : []),
      questConsumerKeys: members.length === 1 ? demand.questConsumerKeys : [...new Set(members.flatMap(member => member.questConsumerKeys))],
      sourceRefs: members.map(member => member.sourceDemandKey),
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
  const activityByActor = new Map(baseActors.map((actor, index) => [actor.key, primaryActors[index]!.scheduleActivities]))
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
    ...(input.context.vendorIdentityContract ? { vendorIdentityContract: input.context.vendorIdentityContract } : {}),
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
      coveredVendorActorReservationKeys: input.context.vendorIdentityContract
        ? input.context.craftingEconomyCatalog.vendors.map(vendor => {
          resolveTextOpenWorldVendorActorV1({ actors: baseActors, vendorIdentityContract: input.context.vendorIdentityContract }, vendor)
          return vendor.actorRequirementKey
        })
        : baseActors.filter(actor => actor.demandKind === 'vendor-service').map(actor => actor.key),
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

function draftFromArtifact(artifact: TextOpenWorldNpcRuntimeCatalogV1, context: TextOpenWorldNpcRuntimeInputContextV1): unknown {
  const baseActors = artifact.actors.filter(actor => actor.demandKind !== 'service-replacement')
  const hasReuses = baseActors.some(actor => actor.sourceRefs.length > 1) || artifact.factions.some(faction => faction.sourceRefs.length > 1)
  const hasVendorReuse = context.actorDemands.some(demand => demand.demandKind === 'vendor-service'
    && baseActors.some(actor => actor.sourceDemandKey !== demand.sourceDemandKey && actor.sourceRefs.includes(demand.sourceDemandKey)))
  return {
    schema: 'storyforge.text-open-world-npc-runtime-draft', version: hasVendorReuse ? 3 : hasReuses ? 2 : 1,
    factions: context.factionDemands.map(demand => {
      const matches = artifact.factions.filter(faction => faction.sourceRefs.includes(demand.sourceDemandKey))
      if (matches.length !== 1) fail('势力需求缺少唯一身份映射')
      const faction = matches[0]!
      const primary = context.factionDemands.find(row => row.sourceDemandKey === faction.sourceDemandKey) ?? fail('势力主身份需求不存在')
      return primary.demandNumber !== demand.demandNumber
        ? { demandNumber: demand.demandNumber, reuseFactionDemandNumber: primary.demandNumber }
        : { demandNumber: demand.demandNumber, description: faction.description, publicGoal: faction.publicGoal, moralityMultiplier: faction.moralityMultiplier }
    }),
    actors: context.actorDemands.map(demand => {
      const matches = baseActors.filter(actor => actor.sourceRefs.includes(demand.sourceDemandKey))
      if (matches.length !== 1) fail('角色需求缺少唯一身份映射')
      const actor = matches[0]!
      const primary = context.actorDemands.find(row => row.sourceDemandKey === actor.sourceDemandKey) ?? fail('角色主身份需求不存在')
      if (primary.demandNumber !== demand.demandNumber) return { demandNumber: demand.demandNumber, reuseActorDemandNumber: primary.demandNumber }
      const faction = artifact.factions.find(row => row.key === actor.factionKey)
      return {
        demandNumber: demand.demandNumber, name: actor.name, biography: actor.biography, portrayal: actor.portrayal,
        factionNumber: actor.factionKey === null ? 0 : (context.factionDemands.find(row => row.sourceDemandKey === faction?.sourceDemandKey)?.demandNumber ?? fail('角色势力身份不存在')),
        scheduleActivities: actor.runtimeMode === 'rule-driven'
          ? artifact.schedules.find(schedule => schedule.actorKey === actor.key)!.entries.map(entry => entry.activity) : [],
      }
    }),
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
  const draft = parseDraft(draftFromArtifact(input.artifact, context), context)
  const rebuilt = await createArtifact({ context, draft, createdAt: input.artifact.createdAt })
  if (canonicalProductProductionJsonV2(rebuilt) !== canonicalProductProductionJsonV2(input.artifact)) fail('角色层级、保护、日程、关系或服务连续性被篡改')
  return structuredClone(input.artifact)
}

export async function projectTextOpenWorldNpcRuntimeCatalogAuthorEditableDraftV1(input: {
  artifact: TextOpenWorldNpcRuntimeCatalogV1
  context: TextOpenWorldNpcRuntimeInputContextV1 | string
}): Promise<unknown> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const artifact = await validateTextOpenWorldNpcRuntimeCatalogV1({ artifact: input.artifact, context })
  return structuredClone(draftFromArtifact(artifact, context))
}

export async function rebuildTextOpenWorldNpcRuntimeCatalogFromAuthorEditableDraftV1(input: {
  baseArtifact: TextOpenWorldNpcRuntimeCatalogV1
  context: TextOpenWorldNpcRuntimeInputContextV1 | string
  draft: unknown
}): Promise<TextOpenWorldNpcRuntimeCatalogV1> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const baseArtifact = await validateTextOpenWorldNpcRuntimeCatalogV1({ artifact: input.baseArtifact, context })
  const artifact = await createArtifact({
    context,
    draft: parseDraft(input.draft, context),
    createdAt: baseArtifact.createdAt,
  })
  return validateTextOpenWorldNpcRuntimeCatalogV1({ artifact, context })
}

function systemPrompt(context: TextOpenWorldNpcRuntimeInputContextV1): string {
  return [
    '你是StoryForge文字开放世界NPC Runtime Catalog Designer。人物小传与演绎说明保持完整文本资产；代码负责角色层级、Agent/规则模式、保护、死亡、日程结构、服务替代、稳定键、关系阈值和运行绑定。',
    `factions共${context.factionDemands.length}项、actors共${context.actorDemands.length}项，必须按demandNumber顺序精确覆盖。factionNumber为0表示无阵营，否则从1开始引用factions。`,
    'agent-maintained角色的scheduleActivities必须为空；rule-driven角色必须依次填写清晨、白天、傍晚、夜晚四条简单活动。moralityMultiplier只能是-1、0、1，表示该势力如何看待玩家道德方向。',
    '只写姓名、小传、演绎、日常活动、势力目标和三档招呼语气。不得输出Actor/Faction/Service/Schedule Key、保护/死亡策略、Action、Scene、Condition、Effect、Quest绑定或数值阈值。',
    context.vendorIdentityContract
      ? '同一人物或势力必须显式复用：使用version:3，复用行仅含demandNumber及reuseActorDemandNumber（势力用reuseFactionDemandNumber），引用前面已有固定身份的内容需求。未预留的任务角色可复用；vendor-service商店岗位也可绑定同地区、同homeLocationKey的固定content-requirement角色，多家店可由一人经营。两个固定内容人物不能合并，不按姓名猜测，不得引用另一岗位、别名或不同地点人物。目标保留完整小传、演绎、阵营与家园，所有服务和任务来源汇总，采用最强保护；任一角色需求为agent-maintained时目标scheduleActivities必须[]。旧version:1/2仍有效但不允许商店岗位复用。'
      : '若任务需求明确指向前面已经预留的同一人物或势力，使用version:2并将该需求行仅写为{"demandNumber":本项编号,"reuseActorDemandNumber":前面的角色需求编号}，或势力行的reuseFactionDemandNumber；目标必须已有fixedActorKey/fixedFactionKey，当前需求必须没有预留身份。不同人物不得因名字相近而合并，两个预留身份及商店岗位不能合并。同一人物只保留目标行的小传/演绎；若任一复用需求是agent-maintained，目标行scheduleActivities填[]，代码保留全部任务与最强保护。没有复用的旧version:1仍有效。',
    '只输出字段精确的JSON：',
    '{"schema":"storyforge.text-open-world-npc-runtime-draft","version":1,"factions":[{"demandNumber":1,"description":"...","publicGoal":"...","moralityMultiplier":0}],"actors":[{"demandNumber":1,"name":"...","biography":"...","portrayal":"...","factionNumber":0,"scheduleActivities":[]}],"attitudeBands":[{"attitude":"bad","label":"...","greetingTone":"..."},{"attitude":"neutral","label":"...","greetingTone":"..."},{"attitude":"good","label":"...","greetingTone":"..."}]}',
  ].join('\n')
}

async function defaultModelRunner(input: Parameters<TextOpenWorldNpcRuntimeModelRunnerV1>[0]): Promise<TextOpenWorldNpcRuntimeModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId, requirementKey: input.requirementKey,
    expectedCapabilityHash: input.expectedCapabilityHash, category: input.category,
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
    execution = captureTextOpenWorldTaskExecutionInputV1(execution)
    await assertTextOpenWorldBuildNewWorkV1({ scope: execution.scope, productionId: execution.productionId,
      buildId: execution.buildId, operation: '执行新的文字开放世界制作任务' })
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p8.catalog.npc-runtime' || execution.task.skillId !== SKILL_ID || execution.task.executionMode !== 'model') fail('executor只接受P8 NPC Runtime任务')
    if (canonicalProductProductionJsonV2(execution.task.outputArtifactKeys) !== canonicalProductProductionJsonV2(['text-open-world.npc-runtime-catalog'])) fail('NPC Runtime输出Artifact集合不精确')
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('NPC Runtime需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!; const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey)
    if (!binding) fail('NPC Runtime缺少文本capability binding')
    const context = await parseContext(execution.contextText); const prompt = systemPrompt(context); const startedAt = performance.now()
    const response = await runModel({
      projectId: execution.scope.projectId, requirementKey, expectedCapabilityHash: binding.bindingHash,
      category: SKILL_ID,
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
