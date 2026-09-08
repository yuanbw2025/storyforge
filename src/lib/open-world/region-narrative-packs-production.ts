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
  TextOpenWorldExperienceContractV1,
  TextOpenWorldGameBriefV1,
  TextOpenWorldMainlineThreadV1,
  TextOpenWorldRegionNarrativePacksV1,
  TextOpenWorldRegionSkeletonV1,
  TextOpenWorldRegionalCharacterTierV1,
  TextOpenWorldRegionalEventKindV1,
  TextOpenWorldSignificantThreadsV1,
  TextOpenWorldSourceLedgerEntryV1,
  TextOpenWorldSourceLedgerV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'

const SKILL_ID = 'text-open-world.production.region-narrative-packs.v1'
const MAX_SELECTED_CLAIMS = 300
const MAX_CONTEXT_CHARS = 300_000
const CHARACTER_TIERS = ['important', 'recurring', 'functional', 'ambient'] as const
const EVENT_KINDS = ['ambient', 'opportunity', 'danger', 'discovery', 'social'] as const
const CONTENT_RISKS = ['safe', 'ordinary', 'dangerous'] as const
const EVENT_REPEATABILITY = ['one-shot', 'repeatable-variant'] as const
const RUMOR_TARGETS = ['location', 'quest', 'event', 'tension', 'character'] as const

export interface TextOpenWorldRegionNarrativePacksInputContextV1 {
  schema: 'storyforge.text-open-world-region-narrative-packs-input'
  version: 1
  productInstanceKey: string
  gameBrief: TextOpenWorldGameBriefV1
  experienceContract: TextOpenWorldExperienceContractV1
  sourceLedger: {
    ledgerHash: string
    totalClaimCount: number
    selectedClaims: TextOpenWorldSourceLedgerEntryV1[]
    omittedClaimCount: number
    omittedClaimsHash: string
  }
  regionSkeleton: TextOpenWorldRegionSkeletonV1
  mainlineThread: TextOpenWorldMainlineThreadV1
  significantThreads: TextOpenWorldSignificantThreadsV1
  /** Missing from historical durable P7 Contexts, which retain the old rumor seed shape. */
  knowledgeSeedContract?: 'governed-v1'
  contextSelectionHash: string
}

export interface TextOpenWorldRegionNarrativePacksModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldRegionNarrativePacksModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  expectedCapabilityHash: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldRegionNarrativePacksModelExecutionV1>

interface RegionNarrativePacksDraftV1 {
  packs: Array<{
    regionNumber: number
    title: string
    fantasy: string
    localConflict: string
    regionalQuestion: string
    dailyLifeBaseline: string
    distinctivenessStatement: string
    sourceClaimKeys: string[]
    tensions: Array<{ title: string; sideA: string; sideB: string; stakes: string; pressureAxis: string }>
    stateAxes: Array<{ title: string; lowExpression: string; middleExpression: string; highExpression: string }>
    locations: Array<{
      locationNumber: number
      dailyLife: string
      activityPatterns: string[]
      npcRoleNeeds: string[]
      rumorHooks: string[]
      timeExpressions: string[]
      contentRisk: 'safe' | 'ordinary' | 'dangerous'
    }>
    characters: Array<{
      tier: TextOpenWorldRegionalCharacterTierV1
      roleTitle: string
      narrativeFunction: string
      homeLocationNumber: number
      routine: string
      serviceNeeds: string[]
      significantThreadNumbers: number[]
      sourceClaimKeys: string[]
    }>
    factions: Array<{
      title: string
      publicGoal: string
      localResource: string
      visiblePresence: string
      significantThreadNumbers: number[]
      sourceClaimKeys: string[]
    }>
    ordinaryQuestSeeds: Array<{
      title: string
      premise: string
      playerActivity: string
      locationNumbers: number[]
      tensionNumber: number
      rewardNeeds: string[]
      estimatedMinutes: number
      sourceClaimKeys: string[]
    }>
    taskTemplateSeeds: Array<{
      title: string
      storyFrame: string
      locationNumbers: number[]
      variationAxes: string[]
      eligibilitySummary: string
      cooldownIntent: string
      sourceClaimKeys: string[]
    }>
    randomEventSeeds: Array<{
      kind: TextOpenWorldRegionalEventKindV1
      title: string
      setup: string
      playerOpportunity: string
      locationNumbers: number[]
      repeatability: 'one-shot' | 'repeatable-variant'
      sourceClaimKeys: string[]
    }>
    rumors: Array<{
      text: string
      pointsTo: 'location' | 'quest' | 'event' | 'tension' | 'character'
      spoilerBoundary: string
      sourceClaimKeys: string[]
      truthSummary?: string
      reliability?: 'uncertain' | 'likely' | 'confirmed'
      subjectNumber?: number
      minimumRevealGateKind?: 'regional-public' | 'mainline-stage-complete' | 'significant-stage-complete'
      minimumRevealStageNumber?: number | null
    }>
  }>
}

function fail(message: string): never {
  throw new Error(`[text-open-world-region-narrative-packs] ${message}`)
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

function stringArray(value: unknown, label: string, maximum: number, allowEmpty = false): string[] {
  if (!Array.isArray(value) || value.length > maximum || (!allowEmpty && value.length === 0)) {
    fail(`${label}必须是有界数组`)
  }
  const result = value.map((item, index) => text(item, `${label}[${index}]`, 500))
  if (new Set(result).size !== result.length) fail(`${label}不得重复`)
  return result
}

function numberArray(
  value: unknown,
  label: string,
  maximumValue: number,
  maximumItems: number,
  allowEmpty = false,
): number[] {
  if (!Array.isArray(value) || value.length > maximumItems || (!allowEmpty && value.length === 0)) {
    fail(`${label}必须是有界数组`)
  }
  const result = value.map((item, index) => integer(item, `${label}[${index}]`, 1, maximumValue))
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

async function validateLedger(ledger: TextOpenWorldSourceLedgerV1): Promise<void> {
  if (ledger.schema !== 'storyforge.text-open-world-source-ledger' || ledger.version !== 1
    || ledger.productType !== 'text-open-world' || ledger.entries.length !== ledger.claimCount
    || !ledger.entries.length || ledger.entries.length > 5_000) fail('SourceLedger身份或数量无效')
  await assertOwnHash(ledger as unknown as Record<string, unknown>, 'ledgerHash', 'SourceLedger')
  const keys = new Set<string>()
  for (const entry of ledger.entries) {
    if (keys.has(entry.claimKey)) fail(`SourceLedger重复claim:${entry.claimKey}`)
    keys.add(entry.claimKey)
    await assertOwnHash(entry as unknown as Record<string, unknown>, 'entryHash', `SourceLedger claim:${entry.claimKey}`)
  }
}

async function validateUpstream(
  context: Omit<TextOpenWorldRegionNarrativePacksInputContextV1, 'contextSelectionHash'>,
): Promise<void> {
  if (context.knowledgeSeedContract !== undefined && context.knowledgeSeedContract !== 'governed-v1') {
    fail('Knowledge种子生产合同无效')
  }
  const { gameBrief, experienceContract, sourceLedger, regionSkeleton, mainlineThread, significantThreads } = context
  if (gameBrief.schema !== 'storyforge.text-open-world-game-brief' || gameBrief.version !== 1
    || gameBrief.productInstanceKey !== context.productInstanceKey
    || gameBrief.fixedProductBoundary.ordinaryWorldEvolution !== 'continues-with-time') fail('GameBrief身份或普通世界演化边界无效')
  await assertOwnHash(gameBrief as unknown as Record<string, unknown>, 'gameBriefHash', 'GameBrief')
  if (experienceContract.schema !== 'storyforge.text-open-world-experience-contract' || experienceContract.version !== 1
    || experienceContract.productInstanceKey !== context.productInstanceKey
    || experienceContract.gameBriefHash !== gameBrief.gameBriefHash
    || experienceContract.worldEvolution.timeWeatherAndRegionsContinue !== true
    || experienceContract.worldEvolution.importantStorylinesWaitAtSafePoints !== true) fail('ExperienceContract身份或演化边界无效')
  await assertOwnHash(experienceContract as unknown as Record<string, unknown>, 'experienceContractHash', 'ExperienceContract')
  if (!isSha256Hash(sourceLedger.ledgerHash) || !isSha256Hash(sourceLedger.omittedClaimsHash)
    || sourceLedger.totalClaimCount !== sourceLedger.selectedClaims.length + sourceLedger.omittedClaimCount
    || new Set(sourceLedger.selectedClaims.map(claim => claim.claimKey)).size !== sourceLedger.selectedClaims.length) {
    fail('Context SourceLedger摘要无效')
  }
  for (const claim of sourceLedger.selectedClaims) {
    await assertOwnHash(claim as unknown as Record<string, unknown>, 'entryHash', `Context claim:${claim.claimKey}`)
  }
  if (regionSkeleton.schema !== 'storyforge.text-open-world-region-skeleton' || regionSkeleton.version !== 1
    || regionSkeleton.productInstanceKey !== context.productInstanceKey
    || regionSkeleton.gameBriefHash !== gameBrief.gameBriefHash
    || regionSkeleton.sourceLedgerHash !== sourceLedger.ledgerHash
    || regionSkeleton.worldScale.regionCount !== gameBrief.scale.regionCount) fail('RegionSkeleton身份、来源或规模无效')
  await assertOwnHash(regionSkeleton as unknown as Record<string, unknown>, 'regionSkeletonHash', 'RegionSkeleton')
  if (mainlineThread.schema !== 'storyforge.text-open-world-mainline-thread' || mainlineThread.version !== 1
    || mainlineThread.productInstanceKey !== context.productInstanceKey
    || mainlineThread.regionSkeletonHash !== regionSkeleton.regionSkeletonHash
    || mainlineThread.governance.ordinaryStateCannotBlock !== true) fail('MainlineThread身份或主线保护无效')
  await assertOwnHash(mainlineThread as unknown as Record<string, unknown>, 'mainlineThreadHash', 'MainlineThread')
  if (significantThreads.schema !== 'storyforge.text-open-world-significant-threads' || significantThreads.version !== 1
    || significantThreads.productInstanceKey !== context.productInstanceKey
    || significantThreads.mainlineThreadHash !== mainlineThread.mainlineThreadHash
    || significantThreads.regionSkeletonHash !== regionSkeleton.regionSkeletonHash
    || significantThreads.governance.lifecycle !== 'persistent-safe-wait'
    || significantThreads.governance.mainlineCompatibility !== 'cannot-block-or-rewrite') {
    fail('SignificantThreads身份、上游或等待治理无效')
  }
  await assertOwnHash(significantThreads as unknown as Record<string, unknown>, 'significantThreadsHash', 'SignificantThreads')
  const selectedClaims = new Set(sourceLedger.selectedClaims.map(claim => claim.claimKey))
  const requiredClaims = new Set([
    ...experienceContract.sourceClaimKeys,
    ...regionSkeleton.coverage.usedSourceClaimKeys,
    ...significantThreads.coverage.sourceClaimKeys,
  ])
  if ([...requiredClaims].some(key => !selectedClaims.has(key))) fail('地区生态Context缺少上游必需claim')
}

function claimPriority(entry: TextOpenWorldSourceLedgerEntryV1, required: ReadonlySet<string>): number {
  let score = entry.confidence
  if (required.has(entry.claimKey)) score += 20_000
  if (entry.claimKind === 'region' || entry.claimKind === 'location') score += 10_000
  if (entry.claimKind === 'character' || entry.claimKind === 'faction') score += 8_000
  if (entry.claimKind === 'event' || entry.claimKind === 'plot' || entry.claimKind === 'resource') score += 5_000
  return score
}

function selectClaims(items: TextOpenWorldSourceLedgerEntryV1[]): TextOpenWorldSourceLedgerEntryV1[] {
  const selected: TextOpenWorldSourceLedgerEntryV1[] = []
  let usedChars = 2
  for (const item of items) {
    if (selected.length >= MAX_SELECTED_CLAIMS) break
    const chars = canonicalProductProductionJsonV2(item).length + 1
    if (usedChars + chars > 115_000) continue
    selected.push(item)
    usedChars += chars
  }
  return selected
}

async function loadRegionNarrativePacksInput(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
}): Promise<TextOpenWorldRegionNarrativePacksInputContextV1> {
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
    'text-open-world.game-brief', 'text-open-world.experience-contract', 'text-open-world.source-ledger',
    'text-open-world.region-skeleton', 'text-open-world.mainline-thread', 'text-open-world.significant-threads',
  ] as const
  const rowsByKey = Object.fromEntries(keys.map(key => [key, uniqueAcceptedArtifact(rows, key)])) as Record<typeof keys[number], ProductBuildArtifactRecordV1>
  const gameBrief = parseArtifact<TextOpenWorldGameBriefV1>(rowsByKey['text-open-world.game-brief'], 'text-open-world.game-brief')
  const experienceContract = parseArtifact<TextOpenWorldExperienceContractV1>(rowsByKey['text-open-world.experience-contract'], 'text-open-world.experience-contract')
  const ledger = parseArtifact<TextOpenWorldSourceLedgerV1>(rowsByKey['text-open-world.source-ledger'], 'text-open-world.source-ledger')
  const regionSkeleton = parseArtifact<TextOpenWorldRegionSkeletonV1>(rowsByKey['text-open-world.region-skeleton'], 'text-open-world.region-skeleton')
  const mainlineThread = parseArtifact<TextOpenWorldMainlineThreadV1>(rowsByKey['text-open-world.mainline-thread'], 'text-open-world.mainline-thread')
  const significantThreads = parseArtifact<TextOpenWorldSignificantThreadsV1>(rowsByKey['text-open-world.significant-threads'], 'text-open-world.significant-threads')
  const payloads = { gameBrief, experienceContract, ledger, regionSkeleton, mainlineThread, significantThreads }
  const nameByKey = {
    'text-open-world.game-brief': 'gameBrief',
    'text-open-world.experience-contract': 'experienceContract',
    'text-open-world.source-ledger': 'ledger',
    'text-open-world.region-skeleton': 'regionSkeleton',
    'text-open-world.mainline-thread': 'mainlineThread',
    'text-open-world.significant-threads': 'significantThreads',
  } as const
  for (const key of keys) {
    if (await hashProductProductionValueV2(payloads[nameByKey[key]]) !== rowsByKey[key].contentHash) {
      fail(`地区生态上游Artifact行Hash不匹配:${key}`)
    }
  }
  await validateLedger(ledger)
  if (ledger.productInstanceKey !== production.productionKey
    || gameBrief.productInstanceKey !== production.productionKey
    || gameBrief.source.sourceLedgerHash !== ledger.ledgerHash) fail('地区生态上游不属于同一Production或冻结来源链')
  const requiredClaims = new Set([
    ...experienceContract.sourceClaimKeys,
    ...regionSkeleton.coverage.usedSourceClaimKeys,
    ...significantThreads.coverage.sourceClaimKeys,
  ])
  const sortedClaims = [...ledger.entries].sort((left, right) => (
    claimPriority(right, requiredClaims) - claimPriority(left, requiredClaims)
    || left.claimKey.localeCompare(right.claimKey)
  ))
  const selectedClaims = selectClaims(sortedClaims)
  const selectedKeys = new Set(selectedClaims.map(claim => claim.claimKey))
  if ([...requiredClaims].some(key => !selectedKeys.has(key))) fail('Context预算无法容纳地区生态必需claim')
  const omittedKeys = sortedClaims.filter(claim => !selectedKeys.has(claim.claimKey)).map(claim => claim.claimKey).sort()
  const body: Omit<TextOpenWorldRegionNarrativePacksInputContextV1, 'contextSelectionHash'> = {
    schema: 'storyforge.text-open-world-region-narrative-packs-input',
    version: 1,
    productInstanceKey: production.productionKey,
    gameBrief,
    experienceContract,
    sourceLedger: {
      ledgerHash: ledger.ledgerHash,
      totalClaimCount: ledger.claimCount,
      selectedClaims,
      omittedClaimCount: omittedKeys.length,
      omittedClaimsHash: await hashProductProductionValueV2(omittedKeys),
    },
    regionSkeleton,
    mainlineThread,
    significantThreads,
    knowledgeSeedContract: 'governed-v1',
  }
  await validateUpstream(body)
  const context = { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('地区生态Context超过硬上限')
  return context
}

export async function readTextOpenWorldRegionNarrativePacksInputContextV1(
  input: AssembleContextInput,
): Promise<string> {
  if (!input.scope || !Number.isSafeInteger(input.productProductionId)
    || !Number.isSafeInteger(input.productBuildId)) fail('Context读取缺少scope/production/build selector')
  return canonicalProductProductionJsonV2(await loadRegionNarrativePacksInput({
    scope: input.scope,
    productionId: input.productProductionId!,
    buildId: input.productBuildId!,
  }))
}

async function parseContext(value: string): Promise<TextOpenWorldRegionNarrativePacksInputContextV1> {
  let context: TextOpenWorldRegionNarrativePacksInputContextV1
  try { context = JSON.parse(value) as TextOpenWorldRegionNarrativePacksInputContextV1 }
  catch { return fail('Context JSON损坏') }
  if (context.schema !== 'storyforge.text-open-world-region-narrative-packs-input' || context.version !== 1
    || context.productInstanceKey !== context.gameBrief.productInstanceKey
    || context.sourceLedger.ledgerHash !== context.gameBrief.source.sourceLedgerHash
    || context.significantThreads.mainlineThreadHash !== context.mainlineThread.mainlineThreadHash) {
    fail('Context身份或上游链无效')
  }
  const { contextSelectionHash, ...body } = context
  await validateUpstream(body)
  if (!isSha256Hash(contextSelectionHash)
    || await hashProductProductionValueV2(body) !== contextSelectionHash) fail('Context选择Hash不匹配')
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Context超过硬上限')
  return context
}

function parseSourceClaims(
  value: unknown,
  label: string,
  allowed: ReadonlySet<string>,
  allowEmpty = true,
): string[] {
  const keys = stringArray(value, label, 100, allowEmpty)
  if (keys.some(key => !allowed.has(key))) fail(`${label}引用未交付claim`)
  return keys
}

function parseDraft(
  value: unknown,
  context: TextOpenWorldRegionNarrativePacksInputContextV1,
): RegionNarrativePacksDraftV1 {
  const root = record(value, 'draft')
  exactKeys(root, ['schema', 'version', 'packs'], 'draft')
  if (root.schema !== 'storyforge.text-open-world-region-narrative-packs-draft' || root.version !== 1) {
    fail('draft schema/version无效')
  }
  if (!Array.isArray(root.packs) || root.packs.length !== context.regionSkeleton.regions.length) {
    fail(`packs数量必须精确为${context.regionSkeleton.regions.length}`)
  }
  const governedKnowledge = context.knowledgeSeedContract === 'governed-v1'
  const allowedClaims = new Set(context.sourceLedger.selectedClaims.map(claim => claim.claimKey))
  const packs = root.packs.map((item, packIndex) => {
    const pack = record(item, `packs[${packIndex}]`)
    exactKeys(pack, [
      'regionNumber', 'title', 'fantasy', 'localConflict', 'regionalQuestion', 'dailyLifeBaseline',
      'distinctivenessStatement', 'sourceClaimKeys', 'tensions', 'stateAxes', 'locations',
      'characters', 'factions', 'ordinaryQuestSeeds', 'taskTemplateSeeds', 'randomEventSeeds', 'rumors',
    ], `packs[${packIndex}]`)
    const regionNumber = integer(pack.regionNumber, `packs[${packIndex}].regionNumber`, 1, context.regionSkeleton.regions.length)
    const region = context.regionSkeleton.regions[regionNumber - 1]!
    const ownedLocations = context.regionSkeleton.locations.filter(location => location.regionKey === region.key)
    const ownedLocationNumbers = new Set(ownedLocations.map(location => location.order))
    const parseLocationNumbers = (input: unknown, label: string) => {
      const numbers = numberArray(input, label, context.regionSkeleton.locations.length, ownedLocations.length)
      if (numbers.some(number => !ownedLocationNumbers.has(number))) fail(`${label}引用非本地区地点`)
      return numbers
    }
    const sourceClaimKeys = parseSourceClaims(pack.sourceClaimKeys, `packs[${packIndex}].sourceClaimKeys`, allowedClaims, false)
    if (!Array.isArray(pack.tensions) || pack.tensions.length < 2 || pack.tensions.length > 5) {
      fail(`packs[${packIndex}].tensions必须有2到5项`)
    }
    const tensions = pack.tensions.map((tensionItem, tensionIndex) => {
      const tension = record(tensionItem, `tensions[${tensionIndex}]`)
      exactKeys(tension, ['title', 'sideA', 'sideB', 'stakes', 'pressureAxis'], `tensions[${tensionIndex}]`)
      return {
        title: text(tension.title, `tensions[${tensionIndex}].title`, 200),
        sideA: text(tension.sideA, `tensions[${tensionIndex}].sideA`, 500),
        sideB: text(tension.sideB, `tensions[${tensionIndex}].sideB`, 500),
        stakes: text(tension.stakes, `tensions[${tensionIndex}].stakes`),
        pressureAxis: text(tension.pressureAxis, `tensions[${tensionIndex}].pressureAxis`, 500),
      }
    })
    if (!Array.isArray(pack.stateAxes) || pack.stateAxes.length < 2 || pack.stateAxes.length > 5) {
      fail(`packs[${packIndex}].stateAxes必须有2到5项`)
    }
    const stateAxes = pack.stateAxes.map((axisItem, axisIndex) => {
      const axis = record(axisItem, `stateAxes[${axisIndex}]`)
      exactKeys(axis, ['title', 'lowExpression', 'middleExpression', 'highExpression'], `stateAxes[${axisIndex}]`)
      return {
        title: text(axis.title, `stateAxes[${axisIndex}].title`, 200),
        lowExpression: text(axis.lowExpression, `stateAxes[${axisIndex}].lowExpression`),
        middleExpression: text(axis.middleExpression, `stateAxes[${axisIndex}].middleExpression`),
        highExpression: text(axis.highExpression, `stateAxes[${axisIndex}].highExpression`),
      }
    })
    if (!Array.isArray(pack.locations) || pack.locations.length !== ownedLocations.length) {
      fail(`packs[${packIndex}].locations必须覆盖本地区全部地点`)
    }
    const locations = pack.locations.map((locationItem, locationIndex) => {
      const location = record(locationItem, `locations[${locationIndex}]`)
      exactKeys(location, [
        'locationNumber', 'dailyLife', 'activityPatterns', 'npcRoleNeeds',
        'rumorHooks', 'timeExpressions', 'contentRisk',
      ], `locations[${locationIndex}]`)
      const locationNumber = integer(
        location.locationNumber, `locations[${locationIndex}].locationNumber`, 1, context.regionSkeleton.locations.length,
      )
      if (!ownedLocationNumbers.has(locationNumber)) fail(`locations[${locationIndex}]不属于本地区`)
      return {
        locationNumber,
        dailyLife: text(location.dailyLife, `locations[${locationIndex}].dailyLife`),
        activityPatterns: stringArray(location.activityPatterns, `locations[${locationIndex}].activityPatterns`, 8),
        npcRoleNeeds: stringArray(location.npcRoleNeeds, `locations[${locationIndex}].npcRoleNeeds`, 8),
        rumorHooks: stringArray(location.rumorHooks, `locations[${locationIndex}].rumorHooks`, 8),
        timeExpressions: stringArray(location.timeExpressions, `locations[${locationIndex}].timeExpressions`, 8),
        contentRisk: enumValue(location.contentRisk, CONTENT_RISKS, `locations[${locationIndex}].contentRisk`),
      }
    })
    if (new Set(locations.map(location => location.locationNumber)).size !== ownedLocations.length) {
      fail(`packs[${packIndex}].locations存在重复或漏项`)
    }
    const regionalThreadNumbers = new Set(context.significantThreads.threads
      .filter(thread => thread.regionKeys.includes(region.key)).map(thread => thread.order))
    if (!Array.isArray(pack.characters) || pack.characters.length < 2 || pack.characters.length > 20) {
      fail(`packs[${packIndex}].characters必须有2到20项`)
    }
    const characters = pack.characters.map((characterItem, characterIndex) => {
      const character = record(characterItem, `characters[${characterIndex}]`)
      exactKeys(character, [
        'tier', 'roleTitle', 'narrativeFunction', 'homeLocationNumber', 'routine',
        'serviceNeeds', 'significantThreadNumbers', 'sourceClaimKeys',
      ], `characters[${characterIndex}]`)
      const significantThreadNumbers = numberArray(
        character.significantThreadNumbers,
        `characters[${characterIndex}].significantThreadNumbers`,
        context.significantThreads.threads.length,
        context.significantThreads.threads.length,
        true,
      )
      if (significantThreadNumbers.some(number => !regionalThreadNumbers.has(number))) {
        fail(`characters[${characterIndex}]绑定非本地区重要故事`)
      }
      return {
        tier: enumValue(character.tier, CHARACTER_TIERS, `characters[${characterIndex}].tier`),
        roleTitle: text(character.roleTitle, `characters[${characterIndex}].roleTitle`, 200),
        narrativeFunction: text(character.narrativeFunction, `characters[${characterIndex}].narrativeFunction`),
        homeLocationNumber: parseLocationNumbers([character.homeLocationNumber], `characters[${characterIndex}].homeLocationNumber`)[0]!,
        routine: text(character.routine, `characters[${characterIndex}].routine`),
        serviceNeeds: stringArray(character.serviceNeeds, `characters[${characterIndex}].serviceNeeds`, 8, true),
        significantThreadNumbers,
        sourceClaimKeys: parseSourceClaims(character.sourceClaimKeys, `characters[${characterIndex}].sourceClaimKeys`, allowedClaims),
      }
    })
    if (!characters.some(character => character.tier === 'important')
      || !characters.some(character => character.tier === 'functional' || character.tier === 'ambient')) {
      fail(`packs[${packIndex}]必须同时定义重要角色和规则驱动普通角色`)
    }
    if (!Array.isArray(pack.factions) || pack.factions.length < 1 || pack.factions.length > 10) {
      fail(`packs[${packIndex}].factions必须有1到10项`)
    }
    const factions = pack.factions.map((factionItem, factionIndex) => {
      const faction = record(factionItem, `factions[${factionIndex}]`)
      exactKeys(faction, [
        'title', 'publicGoal', 'localResource', 'visiblePresence', 'significantThreadNumbers', 'sourceClaimKeys',
      ], `factions[${factionIndex}]`)
      const significantThreadNumbers = numberArray(
        faction.significantThreadNumbers,
        `factions[${factionIndex}].significantThreadNumbers`,
        context.significantThreads.threads.length,
        context.significantThreads.threads.length,
        true,
      )
      if (significantThreadNumbers.some(number => !regionalThreadNumbers.has(number))) {
        fail(`factions[${factionIndex}]绑定非本地区重要故事`)
      }
      return {
        title: text(faction.title, `factions[${factionIndex}].title`, 200),
        publicGoal: text(faction.publicGoal, `factions[${factionIndex}].publicGoal`),
        localResource: text(faction.localResource, `factions[${factionIndex}].localResource`),
        visiblePresence: text(faction.visiblePresence, `factions[${factionIndex}].visiblePresence`),
        significantThreadNumbers,
        sourceClaimKeys: parseSourceClaims(faction.sourceClaimKeys, `factions[${factionIndex}].sourceClaimKeys`, allowedClaims),
      }
    })
    const parseSeedClaims = (input: unknown, label: string) => parseSourceClaims(input, label, allowedClaims)
    if (!Array.isArray(pack.ordinaryQuestSeeds) || pack.ordinaryQuestSeeds.length > 100) {
      fail(`packs[${packIndex}].ordinaryQuestSeeds必须是有界数组`)
    }
    const ordinaryQuestSeeds = pack.ordinaryQuestSeeds.map((seedItem, seedIndex) => {
      const seed = record(seedItem, `ordinaryQuestSeeds[${seedIndex}]`)
      exactKeys(seed, [
        'title', 'premise', 'playerActivity', 'locationNumbers', 'tensionNumber',
        'rewardNeeds', 'estimatedMinutes', 'sourceClaimKeys',
      ], `ordinaryQuestSeeds[${seedIndex}]`)
      return {
        title: text(seed.title, `ordinaryQuestSeeds[${seedIndex}].title`, 200),
        premise: text(seed.premise, `ordinaryQuestSeeds[${seedIndex}].premise`),
        playerActivity: text(seed.playerActivity, `ordinaryQuestSeeds[${seedIndex}].playerActivity`),
        locationNumbers: parseLocationNumbers(seed.locationNumbers, `ordinaryQuestSeeds[${seedIndex}].locationNumbers`),
        tensionNumber: integer(seed.tensionNumber, `ordinaryQuestSeeds[${seedIndex}].tensionNumber`, 1, tensions.length),
        rewardNeeds: stringArray(seed.rewardNeeds, `ordinaryQuestSeeds[${seedIndex}].rewardNeeds`, 8),
        estimatedMinutes: integer(seed.estimatedMinutes, `ordinaryQuestSeeds[${seedIndex}].estimatedMinutes`, 5, 45),
        sourceClaimKeys: parseSeedClaims(seed.sourceClaimKeys, `ordinaryQuestSeeds[${seedIndex}].sourceClaimKeys`),
      }
    })
    if (!Array.isArray(pack.taskTemplateSeeds) || pack.taskTemplateSeeds.length > 100) {
      fail(`packs[${packIndex}].taskTemplateSeeds必须是有界数组`)
    }
    const taskTemplateSeeds = pack.taskTemplateSeeds.map((seedItem, seedIndex) => {
      const seed = record(seedItem, `taskTemplateSeeds[${seedIndex}]`)
      exactKeys(seed, [
        'title', 'storyFrame', 'locationNumbers', 'variationAxes', 'eligibilitySummary',
        'cooldownIntent', 'sourceClaimKeys',
      ], `taskTemplateSeeds[${seedIndex}]`)
      return {
        title: text(seed.title, `taskTemplateSeeds[${seedIndex}].title`, 200),
        storyFrame: text(seed.storyFrame, `taskTemplateSeeds[${seedIndex}].storyFrame`),
        locationNumbers: parseLocationNumbers(seed.locationNumbers, `taskTemplateSeeds[${seedIndex}].locationNumbers`),
        variationAxes: stringArray(seed.variationAxes, `taskTemplateSeeds[${seedIndex}].variationAxes`, 8),
        eligibilitySummary: text(seed.eligibilitySummary, `taskTemplateSeeds[${seedIndex}].eligibilitySummary`),
        cooldownIntent: text(seed.cooldownIntent, `taskTemplateSeeds[${seedIndex}].cooldownIntent`, 500),
        sourceClaimKeys: parseSeedClaims(seed.sourceClaimKeys, `taskTemplateSeeds[${seedIndex}].sourceClaimKeys`),
      }
    })
    if (!Array.isArray(pack.randomEventSeeds) || pack.randomEventSeeds.length > 200) {
      fail(`packs[${packIndex}].randomEventSeeds必须是有界数组`)
    }
    const randomEventSeeds = pack.randomEventSeeds.map((seedItem, seedIndex) => {
      const seed = record(seedItem, `randomEventSeeds[${seedIndex}]`)
      exactKeys(seed, [
        'kind', 'title', 'setup', 'playerOpportunity', 'locationNumbers', 'repeatability', 'sourceClaimKeys',
      ], `randomEventSeeds[${seedIndex}]`)
      return {
        kind: enumValue(seed.kind, EVENT_KINDS, `randomEventSeeds[${seedIndex}].kind`),
        title: text(seed.title, `randomEventSeeds[${seedIndex}].title`, 200),
        setup: text(seed.setup, `randomEventSeeds[${seedIndex}].setup`),
        playerOpportunity: text(seed.playerOpportunity, `randomEventSeeds[${seedIndex}].playerOpportunity`),
        locationNumbers: parseLocationNumbers(seed.locationNumbers, `randomEventSeeds[${seedIndex}].locationNumbers`),
        repeatability: enumValue(seed.repeatability, EVENT_REPEATABILITY, `randomEventSeeds[${seedIndex}].repeatability`),
        sourceClaimKeys: parseSeedClaims(seed.sourceClaimKeys, `randomEventSeeds[${seedIndex}].sourceClaimKeys`),
      }
    })
    if (!Array.isArray(pack.rumors) || pack.rumors.length < 3 || pack.rumors.length > 12) {
      fail(`packs[${packIndex}].rumors必须有3到12项`)
    }
    const rumors = pack.rumors.map((rumorItem, rumorIndex) => {
      const rumor = record(rumorItem, `rumors[${rumorIndex}]`)
      exactKeys(rumor, governedKnowledge
        ? ['text', 'pointsTo', 'spoilerBoundary', 'sourceClaimKeys', 'truthSummary', 'reliability', 'subjectNumber', 'minimumRevealGateKind', 'minimumRevealStageNumber']
        : ['text', 'pointsTo', 'spoilerBoundary', 'sourceClaimKeys'], `rumors[${rumorIndex}]`)
      const pointsTo = enumValue(rumor.pointsTo, RUMOR_TARGETS, `rumors[${rumorIndex}].pointsTo`)
      const sourceClaimKeys = parseSeedClaims(rumor.sourceClaimKeys, `rumors[${rumorIndex}].sourceClaimKeys`)
      if (governedKnowledge && sourceClaimKeys.length === 0) fail(`rumors[${rumorIndex}]治理字段必须引用至少一个来源claim`)
      const subjectMaximum = pointsTo === 'location' ? ownedLocations.length
        : pointsTo === 'character' ? characters.length
          : pointsTo === 'tension' ? tensions.length
            : pointsTo === 'quest' ? ordinaryQuestSeeds.length + taskTemplateSeeds.length
              : randomEventSeeds.length
      if (governedKnowledge && subjectMaximum < 1) fail(`rumors[${rumorIndex}]目标类型在本地区没有可引用对象`)
      const gateKind = governedKnowledge
        ? enumValue(rumor.minimumRevealGateKind, ['regional-public', 'mainline-stage-complete', 'significant-stage-complete'] as const, `rumors[${rumorIndex}].minimumRevealGateKind`)
        : undefined
      const stageMaximum = gateKind === 'mainline-stage-complete'
        ? context.mainlineThread.stages.length
        : gateKind === 'significant-stage-complete' ? context.significantThreads.stages.length : 0
      const minimumRevealStageNumber = governedKnowledge && gateKind !== 'regional-public'
        ? integer(rumor.minimumRevealStageNumber, `rumors[${rumorIndex}].minimumRevealStageNumber`, 1, stageMaximum)
        : null
      if (governedKnowledge && gateKind === 'regional-public' && rumor.minimumRevealStageNumber !== null) {
        fail(`rumors[${rumorIndex}]公开地区门槛不能携带阶段编号`)
      }
      const selectedRevealStage = gateKind === 'mainline-stage-complete'
        ? context.mainlineThread.stages[(minimumRevealStageNumber ?? 1) - 1]
        : gateKind === 'significant-stage-complete'
          ? context.significantThreads.stages[(minimumRevealStageNumber ?? 1) - 1]
          : null
      if (governedKnowledge && selectedRevealStage && !selectedRevealStage.regionKeys.includes(region.key)) {
        fail(`rumors[${rumorIndex}]揭示阶段不属于本地区`)
      }
      return {
        text: text(rumor.text, `rumors[${rumorIndex}].text`),
        pointsTo,
        spoilerBoundary: text(rumor.spoilerBoundary, `rumors[${rumorIndex}].spoilerBoundary`),
        sourceClaimKeys,
        ...(governedKnowledge ? {
          truthSummary: text(rumor.truthSummary, `rumors[${rumorIndex}].truthSummary`),
          reliability: enumValue(rumor.reliability, ['uncertain', 'likely', 'confirmed'] as const, `rumors[${rumorIndex}].reliability`),
          subjectNumber: integer(rumor.subjectNumber, `rumors[${rumorIndex}].subjectNumber`, 1, subjectMaximum),
          minimumRevealGateKind: gateKind,
          minimumRevealStageNumber,
        } : {}),
      }
    })
    if (governedKnowledge && !rumors.some(rumor => rumor.reliability === 'uncertain')) {
      fail(`packs[${packIndex}]至少需要一条不确定传闻`)
    }
    return {
      regionNumber,
      title: text(pack.title, `packs[${packIndex}].title`, 200),
      fantasy: text(pack.fantasy, `packs[${packIndex}].fantasy`),
      localConflict: text(pack.localConflict, `packs[${packIndex}].localConflict`),
      regionalQuestion: text(pack.regionalQuestion, `packs[${packIndex}].regionalQuestion`),
      dailyLifeBaseline: text(pack.dailyLifeBaseline, `packs[${packIndex}].dailyLifeBaseline`),
      distinctivenessStatement: text(pack.distinctivenessStatement, `packs[${packIndex}].distinctivenessStatement`),
      sourceClaimKeys,
      tensions,
      stateAxes,
      locations,
      characters,
      factions,
      ordinaryQuestSeeds,
      taskTemplateSeeds,
      randomEventSeeds,
      rumors,
    }
  })
  if (new Set(packs.map(pack => pack.regionNumber)).size !== context.regionSkeleton.regions.length) {
    fail('packs必须精确覆盖每个地区一次')
  }
  if (new Set(packs.map(pack => pack.distinctivenessStatement)).size !== packs.length) {
    fail('每个地区必须有不同的体验辨识度')
  }
  const ordinaryCount = packs.reduce((sum, pack) => sum + pack.ordinaryQuestSeeds.length, 0)
  const templateCount = packs.reduce((sum, pack) => sum + pack.taskTemplateSeeds.length, 0)
  const eventCount = packs.reduce((sum, pack) => sum + pack.randomEventSeeds.length, 0)
  if (ordinaryCount !== context.gameBrief.scale.ordinaryQuestRange.minimum) {
    fail(`普通任务种子总数必须精确为首版保底${context.gameBrief.scale.ordinaryQuestRange.minimum}`)
  }
  if (templateCount !== context.gameBrief.scale.taskTemplateRange.minimum) {
    fail(`任务模板种子总数必须精确为首版保底${context.gameBrief.scale.taskTemplateRange.minimum}`)
  }
  if (eventCount !== context.gameBrief.scale.randomEventRange.minimum) {
    fail(`随机事件种子总数必须精确为首版保底${context.gameBrief.scale.randomEventRange.minimum}`)
  }
  const ownerCoverage = new Map<number, number>()
  for (const pack of packs) {
    for (const character of pack.characters) {
      for (const number of character.significantThreadNumbers) {
        if (context.significantThreads.threads[number - 1]!.ownerKind === 'character') {
          ownerCoverage.set(number, (ownerCoverage.get(number) ?? 0) + 1)
        }
      }
    }
    for (const faction of pack.factions) {
      for (const number of faction.significantThreadNumbers) {
        if (context.significantThreads.threads[number - 1]!.ownerKind === 'faction') {
          ownerCoverage.set(number, (ownerCoverage.get(number) ?? 0) + 1)
        }
      }
    }
  }
  for (const thread of context.significantThreads.threads) {
    if ((thread.ownerKind === 'character' || thread.ownerKind === 'faction')
      && ownerCoverage.get(thread.order) !== 1) fail(`重要故事owner必须由唯一地区目录需求兑现:${thread.key}`)
  }
  return { packs }
}

function keyFor(prefix: string, number: number): string {
  return `${prefix}.${String(number).padStart(3, '0')}`
}

function claimsUnion(...groups: string[][]): string[] {
  return [...new Set(groups.flat())].sort()
}

async function createRegionNarrativePacks(input: {
  context: TextOpenWorldRegionNarrativePacksInputContextV1
  draft: RegionNarrativePacksDraftV1
  createdAt: number
}): Promise<TextOpenWorldRegionNarrativePacksV1> {
  const governedKnowledge = input.context.knowledgeSeedContract === 'governed-v1'
  const draftByRegionNumber = new Map(input.draft.packs.map(pack => [pack.regionNumber, pack]))
  let characterRequirementNumber = 0
  let factionRequirementNumber = 0
  let ordinaryQuestNumber = 0
  let taskTemplateNumber = 0
  let randomEventNumber = 0
  let rumorNumber = 0
  const claimedCharacterOwnerThreads = new Set<number>()
  const claimedFactionOwnerThreads = new Set<number>()
  const packs: TextOpenWorldRegionNarrativePacksV1['packs'] = input.context.regionSkeleton.regions.map((region, regionIndex) => {
    const pack = draftByRegionNumber.get(regionIndex + 1)!
    const packKey = keyFor('region-pack', regionIndex + 1)
    const relevantMainline = input.context.mainlineThread.stages.filter(stage => stage.regionKeys.includes(region.key))
    const relevantSignificant = input.context.significantThreads.threads.filter(thread => thread.regionKeys.includes(region.key))
    const tensions = pack.tensions.map((tension, index) => ({
      key: `${packKey}.tension.${String(index + 1).padStart(3, '0')}`,
      order: index + 1,
      ...tension,
      mainlineMayBlock: false as const,
    }))
    const stateAxes = pack.stateAxes.map((axis, index) => ({
      key: `${packKey}.state-axis.${String(index + 1).padStart(3, '0')}`,
      order: index + 1,
      ...axis,
      mainlineMayBlock: false as const,
      runtimeBinding: { status: 'effect-unbound' as const, conditionKeys: [] as [], effectKeys: [] as [] },
    }))
    const locationPlans = [...pack.locations].sort((left, right) => left.locationNumber - right.locationNumber).map(location => {
      const definition = input.context.regionSkeleton.locations[location.locationNumber - 1]!
      return {
        key: `${packKey}.location-plan.${String(definition.order).padStart(3, '0')}`,
        locationKey: definition.key,
        requiredFunctions: [...definition.functions],
        dailyLife: location.dailyLife,
        activityPatterns: location.activityPatterns,
        npcRoleNeeds: location.npcRoleNeeds,
        rumorHooks: location.rumorHooks,
        timeExpressions: location.timeExpressions,
        contentRisk: location.contentRisk,
        catalogBindingStatus: 'unbound' as const,
      }
    })
    const characterRequirements = pack.characters.map((character, index) => {
      characterRequirementNumber += 1
      const ownerThread = character.significantThreadNumbers
        .map(number => input.context.significantThreads.threads[number - 1]!)
        .find(thread => thread.ownerKind === 'character')
      const key = ownerThread && !claimedCharacterOwnerThreads.has(ownerThread.order)
        ? (claimedCharacterOwnerThreads.add(ownerThread.order), ownerThread.ownerKey)
        : keyFor('actor.requirement', characterRequirementNumber)
      return {
        key,
        order: index + 1,
        tier: character.tier,
        roleTitle: character.roleTitle,
        narrativeFunction: character.narrativeFunction,
        homeLocationKey: input.context.regionSkeleton.locations[character.homeLocationNumber - 1]!.key,
        routine: character.routine,
        serviceNeeds: character.serviceNeeds,
        significantThreadKeys: character.significantThreadNumbers.map(number => input.context.significantThreads.threads[number - 1]!.key),
        sourceClaimKeys: [...character.sourceClaimKeys].sort(),
        runtimeMode: character.tier === 'important' ? 'agent-maintained' as const : 'rule-driven' as const,
        protectionRequirement: character.tier === 'important' ? 'protected-nonlethal' as const : 'ordinary-lifecycle' as const,
        catalogBinding: { status: 'actor-unbound' as const, actorKey: null },
      }
    })
    const factionRequirements = pack.factions.map((faction, index) => {
      factionRequirementNumber += 1
      const ownerThread = faction.significantThreadNumbers
        .map(number => input.context.significantThreads.threads[number - 1]!)
        .find(thread => thread.ownerKind === 'faction')
      const key = ownerThread && !claimedFactionOwnerThreads.has(ownerThread.order)
        ? (claimedFactionOwnerThreads.add(ownerThread.order), ownerThread.ownerKey)
        : keyFor('faction.requirement', factionRequirementNumber)
      return {
        key,
        order: index + 1,
        title: faction.title,
        publicGoal: faction.publicGoal,
        localResource: faction.localResource,
        visiblePresence: faction.visiblePresence,
        significantThreadKeys: faction.significantThreadNumbers.map(number => input.context.significantThreads.threads[number - 1]!.key),
        sourceClaimKeys: [...faction.sourceClaimKeys].sort(),
        catalogBinding: { status: 'faction-unbound' as const, factionKey: null },
      }
    })
    const ordinaryQuestSeeds = pack.ordinaryQuestSeeds.map((seed, index) => {
      ordinaryQuestNumber += 1
      return {
        key: keyFor('quest-seed.ordinary', ordinaryQuestNumber),
        order: index + 1,
        title: seed.title,
        premise: seed.premise,
        playerActivity: seed.playerActivity,
        locationKeys: seed.locationNumbers.map(number => input.context.regionSkeleton.locations[number - 1]!.key),
        tensionKey: tensions[seed.tensionNumber - 1]!.key,
        rewardNeeds: seed.rewardNeeds,
        estimatedMinutes: seed.estimatedMinutes,
        sourceClaimKeys: [...seed.sourceClaimKeys].sort(),
        binding: { status: 'quest-unbound' as const, questKey: null },
      }
    })
    const taskTemplateSeeds = pack.taskTemplateSeeds.map((seed, index) => {
      taskTemplateNumber += 1
      return {
        key: keyFor('quest-seed.template', taskTemplateNumber),
        order: index + 1,
        title: seed.title,
        storyFrame: seed.storyFrame,
        locationKeys: seed.locationNumbers.map(number => input.context.regionSkeleton.locations[number - 1]!.key),
        variationAxes: seed.variationAxes,
        eligibilitySummary: seed.eligibilitySummary,
        cooldownIntent: seed.cooldownIntent,
        sourceClaimKeys: [...seed.sourceClaimKeys].sort(),
        binding: { status: 'template-unbound' as const, questTemplateKey: null },
      }
    })
    const randomEventSeeds = pack.randomEventSeeds.map((seed, index) => {
      randomEventNumber += 1
      return {
        key: keyFor('event-seed.random', randomEventNumber),
        order: index + 1,
        kind: seed.kind,
        title: seed.title,
        setup: seed.setup,
        playerOpportunity: seed.playerOpportunity,
        locationKeys: seed.locationNumbers.map(number => input.context.regionSkeleton.locations[number - 1]!.key),
        repeatability: seed.repeatability,
        sourceClaimKeys: [...seed.sourceClaimKeys].sort(),
        binding: { status: 'event-unbound' as const, eventKey: null, effectKeys: [] as [] },
      }
    })
    const rumors = pack.rumors.map((rumor, index) => {
      rumorNumber += 1
      const questSubjects = [...ordinaryQuestSeeds, ...taskTemplateSeeds]
      const subjectNumber = governedKnowledge
        ? rumor.subjectNumber ?? fail(`受治理传闻缺少subjectNumber:${rumorNumber}`)
        : 1
      const subjectSourceKey = rumor.pointsTo === 'location'
        ? locationPlans[subjectNumber - 1]?.locationKey ?? null
        : rumor.pointsTo === 'character'
          ? characterRequirements[subjectNumber - 1]?.key ?? null
          : rumor.pointsTo === 'tension'
            ? tensions[subjectNumber - 1]?.key ?? null
            : rumor.pointsTo === 'quest'
              ? questSubjects[subjectNumber - 1]?.key ?? null
              : randomEventSeeds[subjectNumber - 1]?.key ?? null
      const subjectKind = rumor.pointsTo === 'location' ? 'location' as const
        : rumor.pointsTo === 'character' ? 'actor' as const
          : rumor.pointsTo === 'tension' ? 'lore' as const : 'quest-clue' as const
      const gateKind = governedKnowledge
        ? rumor.minimumRevealGateKind ?? fail(`受治理传闻缺少minimumRevealGateKind:${rumorNumber}`)
        : 'regional-public'
      const stageKey = gateKind === 'mainline-stage-complete'
        ? input.context.mainlineThread.stages[(rumor.minimumRevealStageNumber ?? 0) - 1]?.key
          ?? fail(`受治理传闻主线揭示阶段无效:${rumorNumber}`)
        : gateKind === 'significant-stage-complete'
          ? input.context.significantThreads.stages[(rumor.minimumRevealStageNumber ?? 0) - 1]?.key
            ?? fail(`受治理传闻重要支线揭示阶段无效:${rumorNumber}`)
          : null
      if (governedKnowledge && subjectSourceKey === null) fail(`受治理传闻主题引用无效:${rumorNumber}`)
      return {
        key: keyFor('rumor-seed', rumorNumber),
        order: index + 1,
        text: rumor.text,
        pointsTo: rumor.pointsTo,
        spoilerBoundary: rumor.spoilerBoundary,
        sourceClaimKeys: [...rumor.sourceClaimKeys].sort(),
        ...(governedKnowledge ? {
          truthSummary: rumor.truthSummary ?? fail(`受治理传闻缺少truthSummary:${rumorNumber}`),
          reliability: rumor.reliability ?? fail(`受治理传闻缺少reliability:${rumorNumber}`),
          subjectKind,
          subjectSourceKey,
          minimumRevealGate: { kind: gateKind, stageKey },
        } : {}),
        bindingStatus: 'unbound' as const,
      }
    })
    return {
      key: packKey,
      order: regionIndex + 1,
      regionKey: region.key,
      identity: {
        title: pack.title,
        fantasy: pack.fantasy,
        localConflict: pack.localConflict,
        regionalQuestion: pack.regionalQuestion,
        dailyLifeBaseline: pack.dailyLifeBaseline,
        distinctivenessStatement: pack.distinctivenessStatement,
      },
      sourceClaimKeys: [...pack.sourceClaimKeys].sort(),
      mainlineStageKeys: relevantMainline.map(stage => stage.key),
      significantThreadKeys: relevantSignificant.map(thread => thread.key),
      tensions,
      stateAxes,
      locationPlans,
      characterRequirements,
      factionRequirements,
      ordinaryQuestSeeds,
      taskTemplateSeeds,
      randomEventSeeds,
      rumors,
    }
  })
  const usedClaims = claimsUnion(...packs.flatMap(pack => [
    pack.sourceClaimKeys,
    ...pack.characterRequirements.map(item => item.sourceClaimKeys),
    ...pack.factionRequirements.map(item => item.sourceClaimKeys),
    ...pack.ordinaryQuestSeeds.map(item => item.sourceClaimKeys),
    ...pack.taskTemplateSeeds.map(item => item.sourceClaimKeys),
    ...pack.randomEventSeeds.map(item => item.sourceClaimKeys),
    ...pack.rumors.map(item => item.sourceClaimKeys),
  ]))
  const coveredLocationKeys = packs.flatMap(pack => pack.locationPlans.map(plan => plan.locationKey))
  const basisHash = await hashProductProductionValueV2({
    gameBriefHash: input.context.gameBrief.gameBriefHash,
    experienceContractHash: input.context.experienceContract.experienceContractHash,
    sourceLedgerHash: input.context.sourceLedger.ledgerHash,
    regionSkeletonHash: input.context.regionSkeleton.regionSkeletonHash,
    mainlineThreadHash: input.context.mainlineThread.mainlineThreadHash,
    significantThreadsHash: input.context.significantThreads.significantThreadsHash,
    contextSelectionHash: input.context.contextSelectionHash,
    claimHashes: usedClaims.map(key => input.context.sourceLedger.selectedClaims.find(claim => claim.claimKey === key)!.entryHash),
  })
  const body: Omit<TextOpenWorldRegionNarrativePacksV1, 'regionNarrativePacksHash'> = {
    schema: 'storyforge.text-open-world-region-narrative-packs',
    version: 1,
    productType: 'text-open-world',
    productInstanceKey: input.context.productInstanceKey,
    gameBriefHash: input.context.gameBrief.gameBriefHash,
    experienceContractHash: input.context.experienceContract.experienceContractHash,
    sourceLedgerHash: input.context.sourceLedger.ledgerHash,
    regionSkeletonHash: input.context.regionSkeleton.regionSkeletonHash,
    mainlineThreadHash: input.context.mainlineThread.mainlineThreadHash,
    significantThreadsHash: input.context.significantThreads.significantThreadsHash,
    packs,
    coverage: {
      requiredRegionCount: input.context.regionSkeleton.regions.length,
      actualRegionCount: packs.length,
      requiredLocationKeys: input.context.regionSkeleton.locations.map(location => location.key),
      coveredLocationKeys,
      ordinaryQuestSeedCount: packs.reduce((sum, pack) => sum + pack.ordinaryQuestSeeds.length, 0),
      requiredOrdinaryQuestSeedCount: input.context.gameBrief.scale.ordinaryQuestRange.minimum,
      taskTemplateSeedCount: packs.reduce((sum, pack) => sum + pack.taskTemplateSeeds.length, 0),
      requiredTaskTemplateSeedCount: input.context.gameBrief.scale.taskTemplateRange.minimum,
      randomEventSeedCount: packs.reduce((sum, pack) => sum + pack.randomEventSeeds.length, 0),
      requiredRandomEventSeedCount: input.context.gameBrief.scale.randomEventRange.minimum,
      importantCharacterRequirementCount: packs.flatMap(pack => pack.characterRequirements)
        .filter(character => character.tier === 'important').length,
      sourceClaimKeys: usedClaims,
    },
    governance: {
      everyLocationHasPlan: true,
      everyRegionDistinct: true,
      ordinaryWorldContinues: true,
      mainlineWaits: true,
      importantStoriesWaitAtSafePoints: true,
      regionalConsequencesCannotBlockMainline: true,
      npcRuntimeSplit: 'important-agent-ordinary-rules',
      contentSupply: 'build-seeds-before-runtime-deck',
    },
    downstreamBinding: {
      status: 'requirements-unbound',
      requiredArtifactKeys: [
        'text-open-world.quest-skeletons',
        'text-open-world.content-requirement-manifest',
        'text-open-world.npc-runtime-catalog',
        'text-open-world.map-interaction-catalog',
        'text-open-world.quest-design-documents',
        'text-open-world.director-decks',
      ],
      runtimeReady: false,
    },
    basisHash,
    createdAt: input.createdAt,
  }
  return { ...body, regionNarrativePacksHash: await hashProductProductionValueV2(body) }
}

function draftFromArtifact(
  artifact: TextOpenWorldRegionNarrativePacksV1,
  context: TextOpenWorldRegionNarrativePacksInputContextV1,
): unknown {
  const regionNumberByKey = new Map(context.regionSkeleton.regions.map(region => [region.key, region.order]))
  const locationNumberByKey = new Map(context.regionSkeleton.locations.map(location => [location.key, location.order]))
  const threadNumberByKey = new Map(context.significantThreads.threads.map(thread => [thread.key, thread.order]))
  return {
    schema: 'storyforge.text-open-world-region-narrative-packs-draft',
    version: 1,
    packs: artifact.packs.map(pack => ({
      regionNumber: regionNumberByKey.get(pack.regionKey),
      ...pack.identity,
      sourceClaimKeys: pack.sourceClaimKeys,
      tensions: pack.tensions.map(({ title, sideA, sideB, stakes, pressureAxis }) => ({ title, sideA, sideB, stakes, pressureAxis })),
      stateAxes: pack.stateAxes.map(({ title, lowExpression, middleExpression, highExpression }) => ({
        title, lowExpression, middleExpression, highExpression,
      })),
      locations: pack.locationPlans.map(plan => ({
        locationNumber: locationNumberByKey.get(plan.locationKey),
        dailyLife: plan.dailyLife,
        activityPatterns: plan.activityPatterns,
        npcRoleNeeds: plan.npcRoleNeeds,
        rumorHooks: plan.rumorHooks,
        timeExpressions: plan.timeExpressions,
        contentRisk: plan.contentRisk,
      })),
      characters: pack.characterRequirements.map(character => ({
        tier: character.tier,
        roleTitle: character.roleTitle,
        narrativeFunction: character.narrativeFunction,
        homeLocationNumber: locationNumberByKey.get(character.homeLocationKey),
        routine: character.routine,
        serviceNeeds: character.serviceNeeds,
        significantThreadNumbers: character.significantThreadKeys.map(key => threadNumberByKey.get(key)),
        sourceClaimKeys: character.sourceClaimKeys,
      })),
      factions: pack.factionRequirements.map(faction => ({
        title: faction.title,
        publicGoal: faction.publicGoal,
        localResource: faction.localResource,
        visiblePresence: faction.visiblePresence,
        significantThreadNumbers: faction.significantThreadKeys.map(key => threadNumberByKey.get(key)),
        sourceClaimKeys: faction.sourceClaimKeys,
      })),
      ordinaryQuestSeeds: pack.ordinaryQuestSeeds.map(seed => ({
        title: seed.title,
        premise: seed.premise,
        playerActivity: seed.playerActivity,
        locationNumbers: seed.locationKeys.map(key => locationNumberByKey.get(key)),
        tensionNumber: pack.tensions.findIndex(tension => tension.key === seed.tensionKey) + 1,
        rewardNeeds: seed.rewardNeeds,
        estimatedMinutes: seed.estimatedMinutes,
        sourceClaimKeys: seed.sourceClaimKeys,
      })),
      taskTemplateSeeds: pack.taskTemplateSeeds.map(seed => ({
        title: seed.title,
        storyFrame: seed.storyFrame,
        locationNumbers: seed.locationKeys.map(key => locationNumberByKey.get(key)),
        variationAxes: seed.variationAxes,
        eligibilitySummary: seed.eligibilitySummary,
        cooldownIntent: seed.cooldownIntent,
        sourceClaimKeys: seed.sourceClaimKeys,
      })),
      randomEventSeeds: pack.randomEventSeeds.map(seed => ({
        kind: seed.kind,
        title: seed.title,
        setup: seed.setup,
        playerOpportunity: seed.playerOpportunity,
        locationNumbers: seed.locationKeys.map(key => locationNumberByKey.get(key)),
        repeatability: seed.repeatability,
        sourceClaimKeys: seed.sourceClaimKeys,
      })),
      rumors: pack.rumors.map(rumor => ({
        text: rumor.text,
        pointsTo: rumor.pointsTo,
        spoilerBoundary: rumor.spoilerBoundary,
        sourceClaimKeys: rumor.sourceClaimKeys,
        ...(context.knowledgeSeedContract === 'governed-v1' ? {
          truthSummary: rumor.truthSummary,
          reliability: rumor.reliability,
          subjectNumber: rumor.subjectKind === 'location'
            ? pack.locationPlans.findIndex(item => item.locationKey === rumor.subjectSourceKey) + 1
            : rumor.subjectKind === 'actor'
              ? pack.characterRequirements.findIndex(item => item.key === rumor.subjectSourceKey) + 1
              : rumor.subjectKind === 'lore'
                ? pack.tensions.findIndex(item => item.key === rumor.subjectSourceKey) + 1
                : [...pack.ordinaryQuestSeeds, ...pack.taskTemplateSeeds, ...pack.randomEventSeeds]
                  .filter(item => rumor.pointsTo === 'event'
                    ? item.key.startsWith('event-seed.')
                    : !item.key.startsWith('event-seed.'))
                  .findIndex(item => item.key === rumor.subjectSourceKey) + 1,
          minimumRevealGateKind: rumor.minimumRevealGate?.kind,
          minimumRevealStageNumber: rumor.minimumRevealGate?.stageKey == null
            ? null
            : rumor.minimumRevealGate.kind === 'mainline-stage-complete'
              ? context.mainlineThread.stages.findIndex(stage => stage.key === rumor.minimumRevealGate?.stageKey) + 1
              : context.significantThreads.stages.findIndex(stage => stage.key === rumor.minimumRevealGate?.stageKey) + 1,
        } : {}),
      })),
    })),
  }
}

export async function validateTextOpenWorldRegionNarrativePacksV1(input: {
  artifact: TextOpenWorldRegionNarrativePacksV1
  context: TextOpenWorldRegionNarrativePacksInputContextV1
}): Promise<TextOpenWorldRegionNarrativePacksV1> {
  if (input.artifact.schema !== 'storyforge.text-open-world-region-narrative-packs' || input.artifact.version !== 1
    || input.artifact.productType !== 'text-open-world' || !isSha256Hash(input.artifact.regionNarrativePacksHash)) {
    fail('RegionNarrativePacks Artifact身份或Hash字段无效')
  }
  timestamp(input.artifact.createdAt, 'createdAt')
  const context = await parseContext(canonicalProductProductionJsonV2(input.context))
  const draft = parseDraft(draftFromArtifact(input.artifact, context), context)
  const rebuilt = await createRegionNarrativePacks({ context, draft, createdAt: input.artifact.createdAt })
  if (canonicalProductProductionJsonV2(rebuilt) !== canonicalProductProductionJsonV2(input.artifact)) {
    fail('地区生态覆盖、NPC分层、内容供给、主线保护、稳定键或未绑定槽被篡改')
  }
  return structuredClone(input.artifact)
}

function systemPrompt(context: TextOpenWorldRegionNarrativePacksInputContextV1): string {
  return [
    '你是StoryForge文字开放世界Region Narrative Designer。你为已经冻结的每个地区建立可持续的生活、冲突和内容供给，不生成正式NPC/Faction/Quest/Event/Condition/Effect/Reward/Action目录键。',
    `必须精确输出${context.regionSkeleton.regions.length}个pack并以regionNumber各覆盖一次。全世界普通任务种子精确${context.gameBrief.scale.ordinaryQuestRange.minimum}个、任务模板种子精确${context.gameBrief.scale.taskTemplateRange.minimum}个、随机事件种子精确${context.gameBrief.scale.randomEventRange.minimum}个；这是首版保底供给，后序可在上限内扩展。`,
    '每区必须有独特fantasy、localConflict、regionalQuestion、dailyLifeBaseline和distinctivenessStatement；至少2个tension、2个可演化stateAxis、1个势力需求、2个角色需求和3条不剧透的rumor。pack与角色/势力/内容可以引用selectedClaims，不能引用未交付来源。',
    'locations必须用全局一基locationNumber精确覆盖该区全部地点一次。每个地点写日常、活动模式、NPC角色需求、传闻钩子、昼夜/天气表现和风险，让玩家即使不推进主线也有可见生活与可玩内容；不能自动触发或泄露关键主线。',
    'characters中每区至少一名important和一名functional或ambient。important由后续Agent持续保持且必须保护；其他NPC采用routine和serviceNeeds规则驱动。若character/faction承担某条重要故事，用significantThreadNumbers绑定；角色或势力owner的重要故事必须在其所在地区恰有一个需求承接。',
    '普通任务种子必须包装成不同的小故事并说明实际playerActivity、地点、地区矛盾编号、奖励需求和5到45分钟时长；模板要有至少一个变化轴；随机事件要提供玩家机会并区分one-shot或repeatable-variant。所有后果都只能局部变化，不能阻断主线或让重要故事永久失败。',
    ...(context.knowledgeSeedContract === 'governed-v1' ? [
      '每条rumor还必须写truthSummary、reliability(uncertain|likely|confirmed)、subjectNumber、minimumRevealGateKind和minimumRevealStageNumber。truthSummary只写该传闻最终可确认的事实；text必须是玩家实际听到的说法，不能提前泄露truthSummary。',
      'subjectNumber是一基编号：location对应本地区locations，character对应characters，tension对应tensions，quest对应ordinaryQuestSeeds后接taskTemplateSeeds，event对应randomEventSeeds。所选类型必须在本区存在。',
      'minimumRevealGateKind可为regional-public、mainline-stage-complete或significant-stage-complete；公开地区传闻的阶段编号必须为null，另外两类必须引用Context全局阶段数组的一基编号且该阶段属于本区。每区至少一条reliability=uncertain。',
    ] : []),
    '所有编号都是对应Context数组的一基编号。不要输出任何稳定key、数值Effect、运行Condition、正式目录引用或媒资绑定，这些由代码与后序阶段生成。',
    '只输出一个JSON对象，字段必须精确为：',
    context.knowledgeSeedContract === 'governed-v1'
      ? '{"schema":"storyforge.text-open-world-region-narrative-packs-draft","version":1,"packs":[{"regionNumber":1,"title":"...","fantasy":"...","localConflict":"...","regionalQuestion":"...","dailyLifeBaseline":"...","distinctivenessStatement":"...","sourceClaimKeys":["source.claim.00001"],"tensions":[{"title":"...","sideA":"...","sideB":"...","stakes":"...","pressureAxis":"..."}],"stateAxes":[{"title":"...","lowExpression":"...","middleExpression":"...","highExpression":"..."}],"locations":[{"locationNumber":1,"dailyLife":"...","activityPatterns":["..."],"npcRoleNeeds":["..."],"rumorHooks":["..."],"timeExpressions":["..."],"contentRisk":"safe"}],"characters":[{"tier":"important","roleTitle":"...","narrativeFunction":"...","homeLocationNumber":1,"routine":"...","serviceNeeds":[],"significantThreadNumbers":[1],"sourceClaimKeys":[]}],"factions":[{"title":"...","publicGoal":"...","localResource":"...","visiblePresence":"...","significantThreadNumbers":[],"sourceClaimKeys":[]}],"ordinaryQuestSeeds":[{"title":"...","premise":"...","playerActivity":"...","locationNumbers":[1],"tensionNumber":1,"rewardNeeds":["经验"],"estimatedMinutes":15,"sourceClaimKeys":[]}],"taskTemplateSeeds":[{"title":"...","storyFrame":"...","locationNumbers":[1],"variationAxes":["委托人"],"eligibilitySummary":"...","cooldownIntent":"...","sourceClaimKeys":[]}],"randomEventSeeds":[{"kind":"ambient","title":"...","setup":"...","playerOpportunity":"...","locationNumbers":[1],"repeatability":"repeatable-variant","sourceClaimKeys":[]}],"rumors":[{"text":"...","pointsTo":"tension","spoilerBoundary":"...","sourceClaimKeys":["source.claim.00001"],"truthSummary":"...","reliability":"uncertain","subjectNumber":1,"minimumRevealGateKind":"regional-public","minimumRevealStageNumber":null}]}]}'
      : '{"schema":"storyforge.text-open-world-region-narrative-packs-draft","version":1,"packs":[{"regionNumber":1,"title":"...","fantasy":"...","localConflict":"...","regionalQuestion":"...","dailyLifeBaseline":"...","distinctivenessStatement":"...","sourceClaimKeys":["source.claim.00001"],"tensions":[{"title":"...","sideA":"...","sideB":"...","stakes":"...","pressureAxis":"..."}],"stateAxes":[{"title":"...","lowExpression":"...","middleExpression":"...","highExpression":"..."}],"locations":[{"locationNumber":1,"dailyLife":"...","activityPatterns":["..."],"npcRoleNeeds":["..."],"rumorHooks":["..."],"timeExpressions":["..."],"contentRisk":"safe"}],"characters":[{"tier":"important","roleTitle":"...","narrativeFunction":"...","homeLocationNumber":1,"routine":"...","serviceNeeds":[],"significantThreadNumbers":[1],"sourceClaimKeys":[]}],"factions":[{"title":"...","publicGoal":"...","localResource":"...","visiblePresence":"...","significantThreadNumbers":[],"sourceClaimKeys":[]}],"ordinaryQuestSeeds":[{"title":"...","premise":"...","playerActivity":"...","locationNumbers":[1],"tensionNumber":1,"rewardNeeds":["经验"],"estimatedMinutes":15,"sourceClaimKeys":[]}],"taskTemplateSeeds":[{"title":"...","storyFrame":"...","locationNumbers":[1],"variationAxes":["委托人"],"eligibilitySummary":"...","cooldownIntent":"...","sourceClaimKeys":[]}],"randomEventSeeds":[{"kind":"ambient","title":"...","setup":"...","playerOpportunity":"...","locationNumbers":[1],"repeatability":"repeatable-variant","sourceClaimKeys":[]}],"rumors":[{"text":"...","pointsTo":"tension","spoilerBoundary":"...","sourceClaimKeys":[]}]}]}',
  ].join('\n')
}

async function defaultModelRunner(
  input: Parameters<TextOpenWorldRegionNarrativePacksModelRunnerV1>[0],
): Promise<TextOpenWorldRegionNarrativePacksModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId,
    requirementKey: input.requirementKey,
    expectedCapabilityHash: input.expectedCapabilityHash,
    category: input.category,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: `以下是已登记并验签的地区生态生产输入：\n<region-narrative-packs-input>\n${input.contextText}\n</region-narrative-packs-input>` },
    ],
    maximumOutputTokens: input.maximumOutputTokens,
    signal: input.signal,
    result,
    responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

export function createTextOpenWorldRegionNarrativePacksExecutorV1(options: {
  runModel?: TextOpenWorldRegionNarrativePacksModelRunnerV1
  now?: () => number
} = {}): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultModelRunner
  const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p7.region-narrative-packs' || execution.task.skillId !== SKILL_ID
      || execution.task.executionMode !== 'model') fail('executor只接受P7 RegionNarrativePacks任务')
    if (canonicalProductProductionJsonV2(execution.task.outputArtifactKeys)
      !== canonicalProductProductionJsonV2(['text-open-world.region-narrative-packs'])) {
      fail('P7 RegionNarrativePacks输出Artifact集合不精确')
    }
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('RegionNarrativePacks需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!
    const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey)
    if (!binding) fail('RegionNarrativePacks缺少文本capability binding')
    const context = await parseContext(execution.contextText)
    const prompt = systemPrompt(context)
    const startedAt = performance.now()
    const response = await runModel({
      projectId: execution.scope.projectId,
      requirementKey,
      expectedCapabilityHash: binding.bindingHash,
      category: 'text-open-world.production.region-narrative-packs',
      system: prompt,
      contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(32_000, execution.task.budgetReservation.outputTokens)),
      signal: execution.signal,
    })
    if (response.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
    const draft = parseDraft(parseProductionModelJsonObjectV1(response.output, 'text-open-world-region-narrative-packs'), context)
    const artifact = await validateTextOpenWorldRegionNarrativePacksV1({
      artifact: await createRegionNarrativePacks({ context, draft, createdAt: timestamp(now(), 'createdAt') }),
      context,
    })
    return {
      artifacts: [{
        artifactKey: 'text-open-world.region-narrative-packs',
        kind: 'text-open-world.region-narrative-packs',
        payload: artifact,
        quality: {
          everyRegionCovered: true,
          everyLocationCovered: true,
          regionalDistinctivenessValidated: true,
          npcRuntimeSplitValidated: true,
          minimumContentSupplyValidated: true,
          mainlineProtectionValidated: true,
          downstreamBindingsUnbound: true,
        },
        rights: {
          sourceLedgerHash: context.sourceLedger.ledgerHash,
          regionSkeletonHash: context.regionSkeleton.regionSkeletonHash,
          mainlineThreadHash: context.mainlineThread.mainlineThreadHash,
          significantThreadsHash: context.significantThreads.significantThreadsHash,
        },
      }],
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
