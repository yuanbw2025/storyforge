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
  TextOpenWorldEndingContractsV1,
  TextOpenWorldGameBriefV1,
  TextOpenWorldMainlineGameplayFocusV1,
  TextOpenWorldMainlineThreadV1,
  TextOpenWorldNarrativePromisesV1,
  TextOpenWorldRegionSkeletonV1,
  TextOpenWorldSignificantConsequenceKindV1,
  TextOpenWorldSignificantThreadOwnerKindV1,
  TextOpenWorldSignificantThreadsV1,
  TextOpenWorldSourceLedgerEntryV1,
  TextOpenWorldSourceLedgerV1,
  TextOpenWorldStoryArcV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'

const SKILL_ID = 'text-open-world.production.significant-threads.v1'
const MAX_SELECTED_CLAIMS = 300
const MAX_CONTEXT_CHARS = 300_000
const OWNER_KINDS = ['character', 'faction', 'region'] as const
const GAMEPLAY_FOCUS = ['dialogue', 'investigation', 'exploration', 'combat', 'preparation', 'choice'] as const
const CONSEQUENCE_KINDS = ['morality', 'faction-affinity', 'regional-state', 'npc-attitude', 'resource'] as const
const CONSEQUENCE_DIRECTIONS = ['increase', 'decrease', 'change'] as const
const CONSEQUENCE_MAGNITUDES = ['minor', 'moderate', 'major'] as const

export interface TextOpenWorldSignificantThreadsInputContextV1 {
  schema: 'storyforge.text-open-world-significant-threads-input'
  version: 1
  productInstanceKey: string
  gameBrief: TextOpenWorldGameBriefV1
  sourceLedger: {
    ledgerHash: string
    totalClaimCount: number
    selectedClaims: TextOpenWorldSourceLedgerEntryV1[]
    omittedClaimCount: number
    omittedClaimsHash: string
  }
  storyArc: TextOpenWorldStoryArcV1
  endingContracts: TextOpenWorldEndingContractsV1
  narrativePromises: TextOpenWorldNarrativePromisesV1
  regionSkeleton: TextOpenWorldRegionSkeletonV1
  mainlineThread: TextOpenWorldMainlineThreadV1
  contextSelectionHash: string
}

export interface TextOpenWorldSignificantThreadsModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldSignificantThreadsModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  expectedCapabilityHash: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldSignificantThreadsModelExecutionV1>

interface SignificantThreadsDraftV1 {
  threads: Array<{
    ownerKind: TextOpenWorldSignificantThreadOwnerKindV1
    ownerTitle: string
    title: string
    summary: string
    centralConflict: string
    theme: string
    sourceClaimKeys: string[]
    storyBeatNumbers: number[]
    regionNumbers: number[]
    locationNumbers: number[]
    supportingPromiseNumbers: number[]
    availableAfterMainlineStageNumber: number
    conflictSides: Array<{
      name: string
      goal: string
      resource: string
      pressure: string
    }>
    escalationSteps: string[]
    atmosphereSignals: string[]
    stages: Array<{
      title: string
      summary: string
      dramaticQuestion: string
      regionNumbers: number[]
      locationNumbers: number[]
      gameplayFocus: TextOpenWorldMainlineGameplayFocusV1[]
      playerGoals: string[]
      stageOutcome: string
      durationWeight: number
      localConsequences: Array<{
        kind: TextOpenWorldSignificantConsequenceKindV1
        direction: 'increase' | 'decrease' | 'change'
        magnitude: 'minor' | 'moderate' | 'major'
        description: string
      }>
    }>
  }>
}

function fail(message: string): never {
  throw new Error(`[text-open-world-significant-threads] ${message}`)
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

function integerArray(value: unknown, label: string, minimum: number, maximum: number, limit: number): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > limit) fail(`${label}必须是非空有界数组`)
  const result = value.map((item, index) => integer(item, `${label}[${index}]`, minimum, maximum))
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
    || ledger.entries.length === 0 || ledger.entries.length > 5_000) fail('SourceLedger身份或数量无效')
  await assertOwnHash(ledger as unknown as Record<string, unknown>, 'ledgerHash', 'SourceLedger')
  const keys = new Set<string>()
  for (const entry of ledger.entries) {
    if (keys.has(entry.claimKey)) fail(`SourceLedger重复claim:${entry.claimKey}`)
    keys.add(entry.claimKey)
    await assertOwnHash(entry as unknown as Record<string, unknown>, 'entryHash', `SourceLedger claim:${entry.claimKey}`)
  }
}

async function validateUpstream(
  context: Omit<TextOpenWorldSignificantThreadsInputContextV1, 'contextSelectionHash' | 'sourceLedger'> & {
    sourceLedger: TextOpenWorldSignificantThreadsInputContextV1['sourceLedger']
  },
): Promise<void> {
  const { gameBrief, storyArc, endingContracts, narrativePromises, regionSkeleton, mainlineThread } = context
  if (gameBrief.schema !== 'storyforge.text-open-world-game-brief' || gameBrief.version !== 1
    || gameBrief.productType !== 'text-open-world' || gameBrief.productInstanceKey !== context.productInstanceKey
    || gameBrief.scale.significantStorylineCount < 2
    || gameBrief.fixedProductBoundary.importantStorylinePressure !== 'safe-wait-point') {
    fail('GameBrief身份、重要故事规模或等待策略无效')
  }
  await assertOwnHash(gameBrief as unknown as Record<string, unknown>, 'gameBriefHash', 'GameBrief')
  if (storyArc.schema !== 'storyforge.text-open-world-story-arc' || storyArc.version !== 1
    || storyArc.productInstanceKey !== context.productInstanceKey
    || storyArc.gameBriefHash !== gameBrief.gameBriefHash) fail('StoryArc身份或上游无效')
  await assertOwnHash(storyArc as unknown as Record<string, unknown>, 'storyArcHash', 'StoryArc')
  if (endingContracts.schema !== 'storyforge.text-open-world-ending-contracts' || endingContracts.version !== 1
    || endingContracts.productInstanceKey !== context.productInstanceKey
    || endingContracts.storyArcHash !== storyArc.storyArcHash
    || endingContracts.endings.some(ending => ending.coreGoalStatus !== 'achieved')) fail('EndingContracts身份或主线目标约束无效')
  await assertOwnHash(endingContracts as unknown as Record<string, unknown>, 'endingContractsHash', 'EndingContracts')
  if (narrativePromises.schema !== 'storyforge.text-open-world-narrative-promises' || narrativePromises.version !== 1
    || narrativePromises.productInstanceKey !== context.productInstanceKey
    || narrativePromises.storyArcHash !== storyArc.storyArcHash
    || narrativePromises.endingContractsHash !== endingContracts.endingContractsHash) fail('NarrativePromises身份或上游无效')
  await assertOwnHash(narrativePromises as unknown as Record<string, unknown>, 'narrativePromisesHash', 'NarrativePromises')
  if (regionSkeleton.schema !== 'storyforge.text-open-world-region-skeleton' || regionSkeleton.version !== 1
    || regionSkeleton.productInstanceKey !== context.productInstanceKey
    || regionSkeleton.storyArcHash !== storyArc.storyArcHash
    || regionSkeleton.governance.earlyArrival !== 'all-locations-safe'
    || regionSkeleton.governance.arrivalStoryTrigger !== 'never-critical-location-only') fail('RegionSkeleton身份或提前到达治理无效')
  await assertOwnHash(regionSkeleton as unknown as Record<string, unknown>, 'regionSkeletonHash', 'RegionSkeleton')
  if (mainlineThread.schema !== 'storyforge.text-open-world-mainline-thread' || mainlineThread.version !== 1
    || mainlineThread.productInstanceKey !== context.productInstanceKey
    || mainlineThread.storyArcHash !== storyArc.storyArcHash
    || mainlineThread.endingContractsHash !== endingContracts.endingContractsHash
    || mainlineThread.narrativePromisesHash !== narrativePromises.narrativePromisesHash
    || mainlineThread.regionSkeletonHash !== regionSkeleton.regionSkeletonHash
    || mainlineThread.governance.order !== 'strict-sequential'
    || mainlineThread.governance.pressure !== 'wait-for-player'
    || mainlineThread.governance.ordinaryStateCannotBlock !== true) fail('MainlineThread身份、上游或主线保护无效')
  await assertOwnHash(mainlineThread as unknown as Record<string, unknown>, 'mainlineThreadHash', 'MainlineThread')
  const selectedClaimKeys = new Set(context.sourceLedger.selectedClaims.map(claim => claim.claimKey))
  if (selectedClaimKeys.size !== context.sourceLedger.selectedClaims.length
    || context.sourceLedger.totalClaimCount !== context.sourceLedger.selectedClaims.length + context.sourceLedger.omittedClaimCount
    || !isSha256Hash(context.sourceLedger.ledgerHash) || !isSha256Hash(context.sourceLedger.omittedClaimsHash)) {
    fail('Context SourceLedger选择摘要无效')
  }
  for (const claim of context.sourceLedger.selectedClaims) {
    await assertOwnHash(claim as unknown as Record<string, unknown>, 'entryHash', `Context claim:${claim.claimKey}`)
  }
  const requiredClaims = new Set([
    ...storyArc.sourceClaimKeys,
    ...storyArc.macroBeats.flatMap(beat => beat.sourceClaimKeys),
    ...regionSkeleton.coverage.usedSourceClaimKeys,
  ])
  if ([...requiredClaims].some(key => !selectedClaimKeys.has(key))) fail('重要故事Context缺少故事或地区必需claim')
}

function claimPriority(entry: TextOpenWorldSourceLedgerEntryV1, required: ReadonlySet<string>): number {
  let score = entry.confidence
  if (required.has(entry.claimKey)) score += 20_000
  if (entry.claimKind === 'character' || entry.claimKind === 'faction') score += 10_000
  if (entry.claimKind === 'event' || entry.claimKind === 'plot') score += 8_000
  if (entry.claimKind === 'region' || entry.claimKind === 'location') score += 5_000
  return score
}

function selectClaims(items: TextOpenWorldSourceLedgerEntryV1[]): TextOpenWorldSourceLedgerEntryV1[] {
  const selected: TextOpenWorldSourceLedgerEntryV1[] = []
  let usedChars = 2
  for (const item of items) {
    if (selected.length >= MAX_SELECTED_CLAIMS) break
    const chars = canonicalProductProductionJsonV2(item).length + 1
    if (usedChars + chars > 130_000) continue
    selected.push(item)
    usedChars += chars
  }
  return selected
}

async function loadSignificantThreadsInput(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
}): Promise<TextOpenWorldSignificantThreadsInputContextV1> {
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
    'text-open-world.game-brief', 'text-open-world.source-ledger', 'text-open-world.story-arc',
    'text-open-world.ending-contracts', 'text-open-world.narrative-promises',
    'text-open-world.region-skeleton', 'text-open-world.mainline-thread',
  ] as const
  const artifactRows = Object.fromEntries(keys.map(key => [key, uniqueAcceptedArtifact(rows, key)])) as Record<typeof keys[number], ProductBuildArtifactRecordV1>
  const gameBrief = parseArtifact<TextOpenWorldGameBriefV1>(artifactRows['text-open-world.game-brief'], 'text-open-world.game-brief')
  const ledger = parseArtifact<TextOpenWorldSourceLedgerV1>(artifactRows['text-open-world.source-ledger'], 'text-open-world.source-ledger')
  const storyArc = parseArtifact<TextOpenWorldStoryArcV1>(artifactRows['text-open-world.story-arc'], 'text-open-world.story-arc')
  const endingContracts = parseArtifact<TextOpenWorldEndingContractsV1>(artifactRows['text-open-world.ending-contracts'], 'text-open-world.ending-contracts')
  const narrativePromises = parseArtifact<TextOpenWorldNarrativePromisesV1>(artifactRows['text-open-world.narrative-promises'], 'text-open-world.narrative-promises')
  const regionSkeleton = parseArtifact<TextOpenWorldRegionSkeletonV1>(artifactRows['text-open-world.region-skeleton'], 'text-open-world.region-skeleton')
  const mainlineThread = parseArtifact<TextOpenWorldMainlineThreadV1>(artifactRows['text-open-world.mainline-thread'], 'text-open-world.mainline-thread')
  const payloads = { gameBrief, ledger, storyArc, endingContracts, narrativePromises, regionSkeleton, mainlineThread }
  const payloadNameByKey = {
    'text-open-world.game-brief': 'gameBrief',
    'text-open-world.source-ledger': 'ledger',
    'text-open-world.story-arc': 'storyArc',
    'text-open-world.ending-contracts': 'endingContracts',
    'text-open-world.narrative-promises': 'narrativePromises',
    'text-open-world.region-skeleton': 'regionSkeleton',
    'text-open-world.mainline-thread': 'mainlineThread',
  } as const
  for (const key of keys) {
    if (await hashProductProductionValueV2(payloads[payloadNameByKey[key]]) !== artifactRows[key].contentHash) {
      fail(`重要故事上游Artifact行Hash不匹配:${key}`)
    }
  }
  await validateLedger(ledger)
  if (ledger.productInstanceKey !== production.productionKey
    || gameBrief.productInstanceKey !== production.productionKey
    || gameBrief.source.sourceLedgerHash !== ledger.ledgerHash
    || storyArc.sourceLedgerHash !== ledger.ledgerHash
    || regionSkeleton.sourceLedgerHash !== ledger.ledgerHash) {
    fail('重要故事上游不属于同一Production或冻结来源链')
  }
  const requiredClaimKeys = new Set([
    ...storyArc.sourceClaimKeys,
    ...storyArc.macroBeats.flatMap(beat => beat.sourceClaimKeys),
    ...regionSkeleton.coverage.usedSourceClaimKeys,
  ])
  const sortedClaims = [...ledger.entries].sort((left, right) => (
    claimPriority(right, requiredClaimKeys) - claimPriority(left, requiredClaimKeys)
    || left.claimKey.localeCompare(right.claimKey)
  ))
  const selectedClaims = selectClaims(sortedClaims)
  const selectedKeys = new Set(selectedClaims.map(claim => claim.claimKey))
  if ([...requiredClaimKeys].some(key => !selectedKeys.has(key))) fail('Context预算无法容纳故事与地区必需claim')
  const omittedClaimKeys = sortedClaims.filter(claim => !selectedKeys.has(claim.claimKey)).map(claim => claim.claimKey).sort()
  const body: Omit<TextOpenWorldSignificantThreadsInputContextV1, 'contextSelectionHash'> = {
    schema: 'storyforge.text-open-world-significant-threads-input',
    version: 1,
    productInstanceKey: production.productionKey,
    gameBrief,
    sourceLedger: {
      ledgerHash: ledger.ledgerHash,
      totalClaimCount: ledger.claimCount,
      selectedClaims,
      omittedClaimCount: omittedClaimKeys.length,
      omittedClaimsHash: await hashProductProductionValueV2(omittedClaimKeys),
    },
    storyArc,
    endingContracts,
    narrativePromises,
    regionSkeleton,
    mainlineThread,
  }
  await validateUpstream(body)
  const context = { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('重要故事Context超过硬上限')
  return context
}

/** Reads only accepted product Build artifacts. It never rereads a mutable
 * WorldRelease/novel and never reads or mutates a runtime Session. */
export async function readTextOpenWorldSignificantThreadsInputContextV1(
  input: AssembleContextInput,
): Promise<string> {
  if (!input.scope || !Number.isSafeInteger(input.productProductionId)
    || !Number.isSafeInteger(input.productBuildId)) fail('Context读取缺少scope/production/build selector')
  return canonicalProductProductionJsonV2(await loadSignificantThreadsInput({
    scope: input.scope,
    productionId: input.productProductionId!,
    buildId: input.productBuildId!,
  }))
}

async function parseContext(value: string): Promise<TextOpenWorldSignificantThreadsInputContextV1> {
  let context: TextOpenWorldSignificantThreadsInputContextV1
  try { context = JSON.parse(value) as TextOpenWorldSignificantThreadsInputContextV1 }
  catch { return fail('Context JSON损坏') }
  if (context.schema !== 'storyforge.text-open-world-significant-threads-input' || context.version !== 1
    || context.productInstanceKey !== context.gameBrief.productInstanceKey
    || context.sourceLedger.ledgerHash !== context.gameBrief.source.sourceLedgerHash
    || context.storyArc.sourceLedgerHash !== context.sourceLedger.ledgerHash
    || context.mainlineThread.regionSkeletonHash !== context.regionSkeleton.regionSkeletonHash) {
    fail('Context身份或上游链无效')
  }
  const { contextSelectionHash, ...body } = context
  await validateUpstream(body)
  if (!isSha256Hash(contextSelectionHash)
    || await hashProductProductionValueV2(body) !== contextSelectionHash) fail('Context选择Hash不匹配')
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Context超过硬上限')
  return context
}

function parseDraft(
  value: unknown,
  context: TextOpenWorldSignificantThreadsInputContextV1,
): SignificantThreadsDraftV1 {
  const root = record(value, 'draft')
  exactKeys(root, ['schema', 'version', 'threads'], 'draft')
  if (root.schema !== 'storyforge.text-open-world-significant-threads-draft' || root.version !== 1) {
    fail('draft schema/version无效')
  }
  if (!Array.isArray(root.threads) || root.threads.length !== context.gameBrief.scale.significantStorylineCount) {
    fail(`threads数量必须精确为${context.gameBrief.scale.significantStorylineCount}`)
  }
  const allowedClaimKeys = new Set(context.sourceLedger.selectedClaims.map(claim => claim.claimKey))
  const locationRegionByNumber = new Map(context.regionSkeleton.locations.map(location => [location.order, location.regionKey]))
  const regionKeyByNumber = new Map(context.regionSkeleton.regions.map(region => [region.order, region.key]))
  const threads = root.threads.map((item, threadIndex) => {
    const thread = record(item, `threads[${threadIndex}]`)
    exactKeys(thread, [
      'ownerKind', 'ownerTitle', 'title', 'summary', 'centralConflict', 'theme',
      'sourceClaimKeys', 'storyBeatNumbers', 'regionNumbers', 'locationNumbers',
      'supportingPromiseNumbers', 'availableAfterMainlineStageNumber', 'conflictSides',
      'escalationSteps', 'atmosphereSignals', 'stages',
    ], `threads[${threadIndex}]`)
    const ownerKind = enumValue(thread.ownerKind, OWNER_KINDS, `threads[${threadIndex}].ownerKind`)
    const sourceClaimKeys = stringArray(thread.sourceClaimKeys, `threads[${threadIndex}].sourceClaimKeys`, 100, true)
    if (sourceClaimKeys.some(key => !allowedClaimKeys.has(key))) fail(`threads[${threadIndex}]引用未交付claim`)
    const storyBeatNumbers = integerArray(
      thread.storyBeatNumbers, `threads[${threadIndex}].storyBeatNumbers`, 1, context.storyArc.macroBeats.length, 8,
    )
    if (!sourceClaimKeys.length && !storyBeatNumbers.length) fail(`threads[${threadIndex}]缺少来源或故事锚点`)
    const regionNumbers = integerArray(
      thread.regionNumbers, `threads[${threadIndex}].regionNumbers`, 1, context.regionSkeleton.regions.length, 20,
    )
    const locationNumbers = integerArray(
      thread.locationNumbers, `threads[${threadIndex}].locationNumbers`, 1, context.regionSkeleton.locations.length, 50,
    )
    const declaredRegionKeys = new Set(regionNumbers.map(number => regionKeyByNumber.get(number)!))
    if (locationNumbers.some(number => !declaredRegionKeys.has(locationRegionByNumber.get(number)!))) {
      fail(`threads[${threadIndex}]地点不属于声明地区`)
    }
    const supportingPromiseNumbers = Array.isArray(thread.supportingPromiseNumbers)
      ? thread.supportingPromiseNumbers.map((number, index) => integer(
        number, `threads[${threadIndex}].supportingPromiseNumbers[${index}]`, 1, context.narrativePromises.promises.length,
      ))
      : fail(`threads[${threadIndex}].supportingPromiseNumbers必须是数组`)
    if (new Set(supportingPromiseNumbers).size !== supportingPromiseNumbers.length) {
      fail(`threads[${threadIndex}].supportingPromiseNumbers不得重复`)
    }
    if (!Array.isArray(thread.conflictSides) || thread.conflictSides.length < 2 || thread.conflictSides.length > 4) {
      fail(`threads[${threadIndex}].conflictSides必须有2到4方`)
    }
    const conflictSides = thread.conflictSides.map((sideItem, sideIndex) => {
      const side = record(sideItem, `threads[${threadIndex}].conflictSides[${sideIndex}]`)
      exactKeys(side, ['name', 'goal', 'resource', 'pressure'], `threads[${threadIndex}].conflictSides[${sideIndex}]`)
      return {
        name: text(side.name, `conflictSides[${sideIndex}].name`, 200),
        goal: text(side.goal, `conflictSides[${sideIndex}].goal`),
        resource: text(side.resource, `conflictSides[${sideIndex}].resource`),
        pressure: text(side.pressure, `conflictSides[${sideIndex}].pressure`),
      }
    })
    if (new Set(conflictSides.map(side => side.name)).size !== conflictSides.length) {
      fail(`threads[${threadIndex}]冲突方名称不得重复`)
    }
    if (!Array.isArray(thread.stages) || thread.stages.length < 3 || thread.stages.length > 6) {
      fail(`threads[${threadIndex}].stages必须有3到6项`)
    }
    const stages = thread.stages.map((stageItem, stageIndex) => {
      const stage = record(stageItem, `threads[${threadIndex}].stages[${stageIndex}]`)
      exactKeys(stage, [
        'title', 'summary', 'dramaticQuestion', 'regionNumbers', 'locationNumbers',
        'gameplayFocus', 'playerGoals', 'stageOutcome', 'durationWeight', 'localConsequences',
      ], `threads[${threadIndex}].stages[${stageIndex}]`)
      const stageRegionNumbers = integerArray(
        stage.regionNumbers, `stages[${stageIndex}].regionNumbers`, 1, context.regionSkeleton.regions.length, 20,
      )
      const stageLocationNumbers = integerArray(
        stage.locationNumbers, `stages[${stageIndex}].locationNumbers`, 1, context.regionSkeleton.locations.length, 50,
      )
      const stageRegions = new Set(stageRegionNumbers.map(number => regionKeyByNumber.get(number)!))
      if (stageRegionNumbers.some(number => !regionNumbers.includes(number))
        || stageLocationNumbers.some(number => !locationNumbers.includes(number)
          || !stageRegions.has(locationRegionByNumber.get(number)!))) {
        fail(`threads[${threadIndex}].stages[${stageIndex}]空间引用越界`)
      }
      const gameplayFocus = stringArray(stage.gameplayFocus, `stages[${stageIndex}].gameplayFocus`, 6)
        .map((entry, focusIndex) => enumValue(entry, GAMEPLAY_FOCUS, `stages[${stageIndex}].gameplayFocus[${focusIndex}]`))
      if (!Array.isArray(stage.localConsequences) || stage.localConsequences.length < 1
        || stage.localConsequences.length > 4) fail(`stages[${stageIndex}].localConsequences必须有1到4项`)
      const localConsequences = stage.localConsequences.map((consequenceItem, consequenceIndex) => {
        const consequence = record(consequenceItem, `localConsequences[${consequenceIndex}]`)
        exactKeys(consequence, ['kind', 'direction', 'magnitude', 'description'], `localConsequences[${consequenceIndex}]`)
        return {
          kind: enumValue(consequence.kind, CONSEQUENCE_KINDS, `localConsequences[${consequenceIndex}].kind`),
          direction: enumValue(consequence.direction, CONSEQUENCE_DIRECTIONS, `localConsequences[${consequenceIndex}].direction`),
          magnitude: enumValue(consequence.magnitude, CONSEQUENCE_MAGNITUDES, `localConsequences[${consequenceIndex}].magnitude`),
          description: text(consequence.description, `localConsequences[${consequenceIndex}].description`),
        }
      })
      return {
        title: text(stage.title, `stages[${stageIndex}].title`, 200),
        summary: text(stage.summary, `stages[${stageIndex}].summary`),
        dramaticQuestion: text(stage.dramaticQuestion, `stages[${stageIndex}].dramaticQuestion`),
        regionNumbers: stageRegionNumbers,
        locationNumbers: stageLocationNumbers,
        gameplayFocus,
        playerGoals: stringArray(stage.playerGoals, `stages[${stageIndex}].playerGoals`, 8),
        stageOutcome: text(stage.stageOutcome, `stages[${stageIndex}].stageOutcome`),
        durationWeight: integer(stage.durationWeight, `stages[${stageIndex}].durationWeight`, 1, 10),
        localConsequences,
      }
    })
    const focus = new Set(stages.flatMap(stage => stage.gameplayFocus))
    if (!focus.has('dialogue') || !['investigation', 'exploration', 'choice'].some(kind => focus.has(kind as TextOpenWorldMainlineGameplayFocusV1))) {
      fail(`threads[${threadIndex}]缺少对话与叙事推进体验`)
    }
    return {
      ownerKind,
      ownerTitle: text(thread.ownerTitle, `threads[${threadIndex}].ownerTitle`, 200),
      title: text(thread.title, `threads[${threadIndex}].title`, 200),
      summary: text(thread.summary, `threads[${threadIndex}].summary`),
      centralConflict: text(thread.centralConflict, `threads[${threadIndex}].centralConflict`),
      theme: text(thread.theme, `threads[${threadIndex}].theme`, 500),
      sourceClaimKeys,
      storyBeatNumbers,
      regionNumbers,
      locationNumbers,
      supportingPromiseNumbers,
      availableAfterMainlineStageNumber: integer(
        thread.availableAfterMainlineStageNumber,
        `threads[${threadIndex}].availableAfterMainlineStageNumber`,
        1,
        context.mainlineThread.stages.length,
      ),
      conflictSides,
      escalationSteps: stringArray(thread.escalationSteps, `threads[${threadIndex}].escalationSteps`, 8),
      atmosphereSignals: stringArray(thread.atmosphereSignals, `threads[${threadIndex}].atmosphereSignals`, 12),
      stages,
    }
  })
  if (new Set(threads.map(thread => thread.ownerKind)).size < 2) fail('重要故事至少覆盖两种owner类型')
  if (new Set(threads.map(thread => thread.title)).size !== threads.length) fail('重要故事标题不得重复')
  return { threads }
}

function keyFor(prefix: string, number: number): string {
  return `${prefix}.${String(number).padStart(3, '0')}`
}

function allocateMinutes(weights: number[]): number[] {
  const target = Math.max(30, weights.length * 8)
  const base = 5
  const remaining = target - weights.length * base
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const result = weights.map(weight => base + Math.floor(remaining * weight / totalWeight))
  let remainder = target - result.reduce((sum, value) => sum + value, 0)
  for (let index = 0; remainder > 0; index = (index + 1) % result.length) {
    result[index] += 1
    remainder -= 1
  }
  return result
}

function consequenceTargetKey(
  kind: TextOpenWorldSignificantConsequenceKindV1,
  threadNumber: number,
  primaryRegionKey: string,
): string {
  if (kind === 'morality') return 'player.morality'
  if (kind === 'faction-affinity') return keyFor('faction.significant', threadNumber)
  if (kind === 'regional-state') return primaryRegionKey
  if (kind === 'npc-attitude') return keyFor('actor.significant', threadNumber)
  return 'player.inventory'
}

async function createSignificantThreads(input: {
  context: TextOpenWorldSignificantThreadsInputContextV1
  draft: SignificantThreadsDraftV1
  createdAt: number
}): Promise<TextOpenWorldSignificantThreadsV1> {
  const allStages: TextOpenWorldSignificantThreadsV1['stages'] = []
  const threads: TextOpenWorldSignificantThreadsV1['threads'] = input.draft.threads.map((thread, threadIndex) => {
    const threadNumber = threadIndex + 1
    const threadKey = keyFor('significant-thread', threadNumber)
    const regionKeys = thread.regionNumbers.map(number => input.context.regionSkeleton.regions[number - 1]!.key)
    const locationKeys = thread.locationNumbers.map(number => input.context.regionSkeleton.locations[number - 1]!.key)
    const ownerKey = thread.ownerKind === 'region'
      ? regionKeys[0]!
      : keyFor(thread.ownerKind === 'character' ? 'actor.significant' : 'faction.significant', threadNumber)
    const minutes = allocateMinutes(thread.stages.map(stage => stage.durationWeight))
    const stageRows = thread.stages.map((stage, stageIndex) => {
      const stageKey = `${threadKey}.stage.${String(stageIndex + 1).padStart(3, '0')}`
      const row: TextOpenWorldSignificantThreadsV1['stages'][number] = {
        key: stageKey,
        threadKey,
        order: stageIndex + 1,
        previousStageKey: stageIndex === 0 ? null : `${threadKey}.stage.${String(stageIndex).padStart(3, '0')}`,
        nextStageKey: stageIndex === thread.stages.length - 1
          ? null
          : `${threadKey}.stage.${String(stageIndex + 2).padStart(3, '0')}`,
        title: stage.title,
        summary: stage.summary,
        dramaticQuestion: stage.dramaticQuestion,
        regionKeys: stage.regionNumbers.map(number => input.context.regionSkeleton.regions[number - 1]!.key),
        locationKeys: stage.locationNumbers.map(number => input.context.regionSkeleton.locations[number - 1]!.key),
        gameplayFocus: stage.gameplayFocus,
        playerGoals: stage.playerGoals,
        stageOutcome: stage.stageOutcome,
        safeWaitBefore: true,
        safeWaitAfter: true,
        pacingWeight: stage.durationWeight,
        estimatedMinutes: minutes[stageIndex]!,
        localConsequencePlans: stage.localConsequences.map((consequence, consequenceIndex) => ({
          key: `${stageKey}.consequence.${String(consequenceIndex + 1).padStart(3, '0')}`,
          order: consequenceIndex + 1,
          kind: consequence.kind,
          targetSemanticKey: consequenceTargetKey(consequence.kind, threadNumber, regionKeys[0]!),
          direction: consequence.direction,
          magnitude: consequence.magnitude,
          description: consequence.description,
          runtimeBinding: { status: 'effect-unbound', conditionKeys: [], effectKeys: [] },
        })),
        entryPolicy: {
          mode: 'explicit-important-story-advance',
          arrivalAloneNeverStarts: true,
          previousStageCompletionRequired: stageIndex > 0,
          prerequisiteConditionKeys: [],
        },
        failurePolicy: {
          combat: 'retry-or-respawn',
          story: 'cannot-permanently-fail',
          abandonable: false,
          expirable: false,
          ordinaryStateMayBlock: false,
        },
        contentBinding: {
          status: 'content-unbound',
          questKey: null,
          questStageKeys: [],
          objectiveKeys: [],
          sceneKeys: [],
          actionKeys: [],
          rewardContractKey: null,
        },
      }
      allStages.push(row)
      return row
    })
    return {
      key: threadKey,
      order: threadNumber,
      ownerKind: thread.ownerKind,
      ownerKey,
      ownerTitle: thread.ownerTitle,
      ownerBinding: {
        status: thread.ownerKind === 'region' ? 'region-bound' : 'catalog-unbound',
        actorKey: null,
        factionKey: null,
        regionKey: thread.ownerKind === 'region' ? ownerKey : null,
      },
      title: thread.title,
      summary: thread.summary,
      centralConflict: thread.centralConflict,
      theme: thread.theme,
      sourceClaimKeys: [...thread.sourceClaimKeys].sort(),
      storyBeatKeys: thread.storyBeatNumbers.map(number => input.context.storyArc.macroBeats[number - 1]!.key),
      regionKeys,
      locationKeys,
      supportingPromiseKeys: thread.supportingPromiseNumbers.map(number => input.context.narrativePromises.promises[number - 1]!.key),
      mainlineCompatibility: {
        availableAfterStageKey: input.context.mainlineThread.stages[thread.availableAfterMainlineStageNumber - 1]!.key,
        lastSafeStartStageKey: null,
        requiredMainlineMutationKeys: [],
        mayChangeCoreGoal: false,
        mayBlockMainline: false,
        mayDetermineEndingAlone: false,
      },
      conflictSystem: {
        sides: thread.conflictSides.map((side, sideIndex) => ({
          key: `${threadKey}.side.${String(sideIndex + 1).padStart(3, '0')}`,
          order: sideIndex + 1,
          ...side,
          catalogBindingStatus: 'unbound',
        })),
        escalationSteps: thread.escalationSteps,
        atmosphereSignals: thread.atmosphereSignals,
      },
      stageKeys: stageRows.map(stage => stage.key),
      estimatedMinutes: minutes.reduce((sum, value) => sum + value, 0),
    }
  })
  const usedClaimKeys = [...new Set(threads.flatMap(thread => thread.sourceClaimKeys))].sort()
  const ownerKinds = [...new Set(threads.map(thread => thread.ownerKind))]
  const regionKeys = [...new Set(threads.flatMap(thread => thread.regionKeys))]
  const basisHash = await hashProductProductionValueV2({
    gameBriefHash: input.context.gameBrief.gameBriefHash,
    sourceLedgerHash: input.context.sourceLedger.ledgerHash,
    storyArcHash: input.context.storyArc.storyArcHash,
    endingContractsHash: input.context.endingContracts.endingContractsHash,
    narrativePromisesHash: input.context.narrativePromises.narrativePromisesHash,
    regionSkeletonHash: input.context.regionSkeleton.regionSkeletonHash,
    mainlineThreadHash: input.context.mainlineThread.mainlineThreadHash,
    contextSelectionHash: input.context.contextSelectionHash,
    claimHashes: usedClaimKeys.map(key => input.context.sourceLedger.selectedClaims.find(claim => claim.claimKey === key)!.entryHash),
  })
  const body: Omit<TextOpenWorldSignificantThreadsV1, 'significantThreadsHash'> = {
    schema: 'storyforge.text-open-world-significant-threads',
    version: 1,
    productType: 'text-open-world',
    productInstanceKey: input.context.productInstanceKey,
    gameBriefHash: input.context.gameBrief.gameBriefHash,
    sourceLedgerHash: input.context.sourceLedger.ledgerHash,
    storyArcHash: input.context.storyArc.storyArcHash,
    endingContractsHash: input.context.endingContracts.endingContractsHash,
    narrativePromisesHash: input.context.narrativePromises.narrativePromisesHash,
    regionSkeletonHash: input.context.regionSkeleton.regionSkeletonHash,
    mainlineThreadHash: input.context.mainlineThread.mainlineThreadHash,
    threads,
    stages: allStages,
    coverage: {
      requiredThreadCount: input.context.gameBrief.scale.significantStorylineCount,
      actualThreadCount: threads.length,
      ownerKinds,
      minimumOwnerKindCount: 2,
      regionKeys,
      sourceClaimKeys: usedClaimKeys,
    },
    governance: {
      lifecycle: 'persistent-safe-wait',
      failure: 'cannot-permanently-fail',
      abandonable: false,
      expirable: false,
      pressureWhileAbsent: 'none',
      consequences: 'local-only',
      mainlineCompatibility: 'cannot-block-or-rewrite',
      criticalTrigger: 'never-location-only',
      criticalAssets: 'protected-by-downstream-requirements',
    },
    downstreamBinding: {
      status: 'requirements-unbound',
      requiredArtifactKeys: [
        'text-open-world.quest-skeletons',
        'text-open-world.content-requirement-manifest',
        'text-open-world.npc-runtime-catalog',
        'text-open-world.quest-design-documents',
        'text-open-world.scene-scripts',
        'text-open-world.action-bindings',
      ],
      runtimeReady: false,
    },
    basisHash,
    createdAt: input.createdAt,
  }
  return { ...body, significantThreadsHash: await hashProductProductionValueV2(body) }
}

function draftFromArtifact(
  artifact: TextOpenWorldSignificantThreadsV1,
  context: TextOpenWorldSignificantThreadsInputContextV1,
): unknown {
  const regionNumberByKey = new Map(context.regionSkeleton.regions.map(region => [region.key, region.order]))
  const locationNumberByKey = new Map(context.regionSkeleton.locations.map(location => [location.key, location.order]))
  const beatNumberByKey = new Map(context.storyArc.macroBeats.map(beat => [beat.key, beat.order]))
  const promiseNumberByKey = new Map(context.narrativePromises.promises.map(promise => [promise.key, promise.order]))
  const mainlineNumberByKey = new Map(context.mainlineThread.stages.map(stage => [stage.key, stage.order]))
  const stagesByThread = new Map<string, TextOpenWorldSignificantThreadsV1['stages']>()
  for (const stage of artifact.stages) {
    const rows = stagesByThread.get(stage.threadKey) ?? []
    rows.push(stage)
    stagesByThread.set(stage.threadKey, rows)
  }
  return {
    schema: 'storyforge.text-open-world-significant-threads-draft',
    version: 1,
    threads: artifact.threads.map(thread => ({
      ownerKind: thread.ownerKind,
      ownerTitle: thread.ownerTitle,
      title: thread.title,
      summary: thread.summary,
      centralConflict: thread.centralConflict,
      theme: thread.theme,
      sourceClaimKeys: thread.sourceClaimKeys,
      storyBeatNumbers: thread.storyBeatKeys.map(key => beatNumberByKey.get(key)),
      regionNumbers: thread.regionKeys.map(key => regionNumberByKey.get(key)),
      locationNumbers: thread.locationKeys.map(key => locationNumberByKey.get(key)),
      supportingPromiseNumbers: thread.supportingPromiseKeys.map(key => promiseNumberByKey.get(key)),
      availableAfterMainlineStageNumber: mainlineNumberByKey.get(thread.mainlineCompatibility.availableAfterStageKey),
      conflictSides: thread.conflictSystem.sides.map(side => ({
        name: side.name, goal: side.goal, resource: side.resource, pressure: side.pressure,
      })),
      escalationSteps: thread.conflictSystem.escalationSteps,
      atmosphereSignals: thread.conflictSystem.atmosphereSignals,
      stages: (stagesByThread.get(thread.key) ?? []).sort((left, right) => left.order - right.order).map(stage => ({
        title: stage.title,
        summary: stage.summary,
        dramaticQuestion: stage.dramaticQuestion,
        regionNumbers: stage.regionKeys.map(key => regionNumberByKey.get(key)),
        locationNumbers: stage.locationKeys.map(key => locationNumberByKey.get(key)),
        gameplayFocus: stage.gameplayFocus,
        playerGoals: stage.playerGoals,
        stageOutcome: stage.stageOutcome,
        durationWeight: stage.pacingWeight,
        localConsequences: stage.localConsequencePlans.map(consequence => ({
          kind: consequence.kind,
          direction: consequence.direction,
          magnitude: consequence.magnitude,
          description: consequence.description,
        })),
      })),
    })),
  }
}

export async function validateTextOpenWorldSignificantThreadsV1(input: {
  artifact: TextOpenWorldSignificantThreadsV1
  context: TextOpenWorldSignificantThreadsInputContextV1
}): Promise<TextOpenWorldSignificantThreadsV1> {
  if (input.artifact.schema !== 'storyforge.text-open-world-significant-threads' || input.artifact.version !== 1
    || input.artifact.productType !== 'text-open-world' || !isSha256Hash(input.artifact.significantThreadsHash)) {
    fail('SignificantThreads Artifact身份或Hash字段无效')
  }
  timestamp(input.artifact.createdAt, 'createdAt')
  const context = await parseContext(canonicalProductProductionJsonV2(input.context))
  const reconstructed = draftFromArtifact(input.artifact, context)
  const draft = parseDraft(reconstructed, context)
  const rebuilt = await createSignificantThreads({ context, draft, createdAt: input.artifact.createdAt })
  if (canonicalProductProductionJsonV2(rebuilt) !== canonicalProductProductionJsonV2(input.artifact)) {
    fail('重要故事owner、主线兼容、局部后果、等待保护、稳定键或未绑定槽被篡改')
  }
  return structuredClone(input.artifact)
}

function systemPrompt(context: TextOpenWorldSignificantThreadsInputContextV1): string {
  return [
    '你是StoryForge文字开放世界Significant Story Designer。你设计角色个人长篇、势力纷争或地区命运线的结构，不生成QuestDefinition、Scene正文、NPC/Faction目录、Condition、Effect、Reward或Action键。',
    `必须精确生成${context.gameBrief.scale.significantStorylineCount}条重要故事线，并至少覆盖character、faction、region中的两种ownerKind。character/faction只是后续目录需要兑现的语义主人；region以regionNumbers首项为主人。`,
    '每条线必须来自已交付sourceClaimKeys或StoryArc的storyBeatNumbers，并落到有效地区和地点。sourceClaimKeys只能使用selectedClaims；全部编号均是一基数组编号。',
    '重要故事不可放弃、过期或永久失败，在每一阶段前后都可无限安全等待；玩家不参与时不施压。availableAfterMainlineStageNumber只描述可揭示窗口，不得要求修改、阻断或重写主线，不得单独改变核心目标或决定结局。抵达地点绝不能成为唯一触发。',
    '每条线写3到6个顺序阶段，整线必须包含dialogue以及investigation/exploration/choice至少一种。每阶段写可游玩的playerGoals和1到4项局部后果计划；后果只能属于morality、faction-affinity、regional-state、npc-attitude、resource，不能写主线进度。',
    '势力和地区群像不能只靠一句概述：conflictSides必须有2到4方并分别声明目标、可调动资源和当前压力；escalationSteps描述事态升级，atmosphereSignals描述通过传闻、环境、功能NPC和地方事件如何持续营造氛围。',
    'supportingPromiseNumbers可以为空，且只能作为主线NarrativePromise的辅助回响，不能成为唯一建立或回收位置。不要输出稳定key、运行条件、数值Effect或任何已实现目录引用。',
    '只输出一个JSON对象，字段必须精确为：',
    '{"schema":"storyforge.text-open-world-significant-threads-draft","version":1,"threads":[{"ownerKind":"character","ownerTitle":"...","title":"...","summary":"...","centralConflict":"...","theme":"...","sourceClaimKeys":["source.claim.00001"],"storyBeatNumbers":[1,2],"regionNumbers":[1],"locationNumbers":[1,2],"supportingPromiseNumbers":[1],"availableAfterMainlineStageNumber":1,"conflictSides":[{"name":"...","goal":"...","resource":"...","pressure":"..."},{"name":"...","goal":"...","resource":"...","pressure":"..."}],"escalationSteps":["...","..."],"atmosphereSignals":["...","..."],"stages":[{"title":"...","summary":"...","dramaticQuestion":"...","regionNumbers":[1],"locationNumbers":[1],"gameplayFocus":["dialogue","investigation"],"playerGoals":["..."],"stageOutcome":"...","durationWeight":2,"localConsequences":[{"kind":"npc-attitude","direction":"increase","magnitude":"minor","description":"..."}]}]}]}',
  ].join('\n')
}

async function defaultModelRunner(
  input: Parameters<TextOpenWorldSignificantThreadsModelRunnerV1>[0],
): Promise<TextOpenWorldSignificantThreadsModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId,
    requirementKey: input.requirementKey,
    expectedCapabilityHash: input.expectedCapabilityHash,
    category: input.category,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: `以下是已登记并验签的重要故事生产输入：\n<significant-threads-input>\n${input.contextText}\n</significant-threads-input>` },
    ],
    maximumOutputTokens: input.maximumOutputTokens,
    signal: input.signal,
    result,
    responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

export function createTextOpenWorldSignificantThreadsExecutorV1(options: {
  runModel?: TextOpenWorldSignificantThreadsModelRunnerV1
  now?: () => number
} = {}): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultModelRunner
  const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p6.significant-threads' || execution.task.skillId !== SKILL_ID
      || execution.task.executionMode !== 'model') fail('executor只接受P6 SignificantThreads任务')
    if (canonicalProductProductionJsonV2(execution.task.outputArtifactKeys)
      !== canonicalProductProductionJsonV2(['text-open-world.significant-threads'])) {
      fail('P6 SignificantThreads输出Artifact集合不精确')
    }
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('SignificantThreads需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!
    const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey)
    if (!binding) fail('SignificantThreads缺少文本capability binding')
    const context = await parseContext(execution.contextText)
    const prompt = systemPrompt(context)
    const startedAt = performance.now()
    const response = await runModel({
      projectId: execution.scope.projectId,
      requirementKey,
      expectedCapabilityHash: binding.bindingHash,
      category: 'text-open-world.production.significant-threads',
      system: prompt,
      contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(32_000, execution.task.budgetReservation.outputTokens)),
      signal: execution.signal,
    })
    if (response.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
    const draft = parseDraft(parseProductionModelJsonObjectV1(response.output, 'text-open-world-significant-threads'), context)
    const artifact = await validateTextOpenWorldSignificantThreadsV1({
      artifact: await createSignificantThreads({ context, draft, createdAt: timestamp(now(), 'createdAt') }),
      context,
    })
    return {
      artifacts: [{
        artifactKey: 'text-open-world.significant-threads',
        kind: 'text-open-world.significant-threads',
        payload: artifact,
        quality: {
          exactThreadCount: true,
          ownerCoverageValidated: true,
          mainlineCompatibilityValidated: true,
          localConsequencesOnly: true,
          protectedWaitValidated: true,
          downstreamBindingsUnbound: true,
        },
        rights: {
          sourceLedgerHash: context.sourceLedger.ledgerHash,
          storyArcHash: context.storyArc.storyArcHash,
          mainlineThreadHash: context.mainlineThread.mainlineThreadHash,
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
