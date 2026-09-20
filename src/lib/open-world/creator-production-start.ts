import { db } from '../db/schema'
import type {
  AIConfig,
  ProductProductionBriefRecordV1,
  ProductProductionBriefV3,
  ProductProductionPlanV3,
  ProductProductionRecordV1,
  TextOpenWorldCreatorBriefV1,
  TextOpenWorldCreatorProductionPreflightConfirmationV1,
  TextOpenWorldCreatorProductionPreflightV1,
  TextOpenWorldCreatorProductionSourcePlanV1,
  TextOpenWorldCreatorProductionStartV1,
  TextOpenWorldCreatorSourceLocatorV1,
  TextOpenWorldSourceRightsBasisV1,
  WorkspaceScope,
} from '../types'
import {
  assertWorldSemanticReleaseCurrentV1,
  worldSemanticReleaseTransactionTablesV1,
} from '../context-gateway/world-release-client'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import {
  inspectTextOpenWorldCreatorSourceLocatorV1,
  verifyTextOpenWorldCreatorBriefV1,
} from './creator-brief-persistence'
import { verifyTextOpenWorldCreatorProductionPreflightConfirmationV1 } from './creator-production-preflight'
import {
  createTextOpenWorldProductionPlanV1,
  TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1,
} from './production-contract'
import { TEXT_OPEN_WORLD_REQUIRED_KEY_PORTRAIT_COUNT_V1 } from './product-config'
import {
  assertTextOpenWorldNovelSourceCasWitnessCurrentV1,
  createTextOpenWorldNovelSourceCasWitnessV1,
  prepareTextOpenWorldNovelSourceSnapshotV1,
  prepareTextOpenWorldWorldSourceBoundaryV1,
  textOpenWorldNovelSourceTransactionTablesV1,
  type TextOpenWorldNovelSourceCasWitnessV1,
} from './source-pin'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const MAX_SOURCE_UNITS = TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1.maximumUnits
const MAX_SOURCE_TOTAL_CHARS = TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1.maximumTotalChars

function fail(message: string): never {
  throw new Error('[text-open-world-creator-start] ' + message)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' 必须是对象')
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(label + ' 字段不精确')
  }
}

function stableKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !STABLE_KEY.test(value)) fail(label + ' 不是稳定 key')
  return value
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isSha256Hash(value)) fail(label + ' 不是 SHA-256')
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail(label + ' 必须是正整数')
  return Number(value)
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(label + ' 必须是非负整数')
  return Number(value)
}

function normalizedText(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string') fail(label + ' 必须是字符串')
  const result = value.trim().normalize('NFC')
  if ((!allowEmpty && !result) || result.length > maximum) fail(label + ' 为空或过长')
  return result
}

/** Re-read only the mutable source identity at the final authorization CAS.
 * Physical WorldRelease decoding remains behind the neutral Gateway client;
 * novel rows remain behind the product-private source snapshot adapter. */
export async function assertTextOpenWorldCreatorProductionSourceCurrentV1(input: {
  scope: WorkspaceScope
  sourceLocator: TextOpenWorldCreatorSourceLocatorV1
  novelSourceCasWitness?: TextOpenWorldNovelSourceCasWitnessV1 | null
}): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  if (input.sourceLocator.kind === 'world-release') {
    await assertWorldSemanticReleaseCurrentV1({
      localReleaseRecordId: input.sourceLocator.localReleaseRecordId,
      expectedProjectId: scope.projectId,
      expectedWorldId: scope.worldId,
      expectedReleaseHash: input.sourceLocator.expectedReleaseHash,
    })
    return
  }
  const witness = input.novelSourceCasWitness
  if (!witness
    || witness.sourceVersionHash !== input.sourceLocator.expectedSourceVersionHash
    || witness.sourceBoundaryHash !== input.sourceLocator.expectedSourceBoundaryHash) {
    fail('小说来源缺少事务外冻结见证')
  }
  await assertTextOpenWorldNovelSourceCasWitnessCurrentV1({
    scope,
    selection: input.sourceLocator.selection,
    witness,
  })
}

/** Returns only opaque Dexie table capabilities required to keep the final
 * source compare-and-swap in the same transaction as Build authorization. */
export function textOpenWorldCreatorProductionSourceTransactionTablesV1(
  sourceLocator: TextOpenWorldCreatorSourceLocatorV1,
) {
  return sourceLocator.kind === 'world-release'
    ? worldSemanticReleaseTransactionTablesV1()
    : textOpenWorldNovelSourceTransactionTablesV1()
}

function sourceUnitArtifactKeys(count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_SOURCE_UNITS) {
    fail('来源单元数量必须在 1 到 ' + MAX_SOURCE_UNITS + ' 之间')
  }
  return Array.from({ length: count }, (_, index) => index === 0
    ? 'text-open-world.source-pin-unit'
    : 'text-open-world.source-pin-unit.' + String(index + 1).padStart(5, '0'))
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}

async function nestedHashValid(value: unknown, hashKey: string, expectedSchema: string): Promise<boolean> {
  const row = record(value, expectedSchema)
  if (row.schema !== expectedSchema || row.version !== 1 || !isSha256Hash(row[hashKey])) return false
  const body = Object.fromEntries(Object.entries(row).filter(([key]) => key !== hashKey))
  return await hashProductProductionValueV2(body) === row[hashKey]
}

function planSelectionKey(sourceBindingHash: string): string {
  // ProductProductionBriefV3 is only a scheduler compatibility envelope, but
  // its shared parser still requires every source coordinate to use the
  // portable WorldRelease namespace. This synthetic key never authorizes a
  // read; the dedicated Creator SourcePlan remains the only P0/P1 boundary.
  return 'world-release:creator-source-plan:' + sourceBindingHash.slice(0, 24)
}

async function capabilityRequirement(input: {
  requirementKey: string
  mediaClass: 'text' | 'image'
  required: boolean
  maximumTotalCost: number | null
}) {
  const body = {
    requirementKey: input.requirementKey,
    mediaClass: input.mediaClass,
    operation: 'generate',
    adapterFamily: input.mediaClass === 'text' ? 'configured-text' : 'configured-media',
    minimumCapabilityVersion: '1',
    allowedDataClasses: ['creator-brief', 'frozen-source-plan', 'accepted-build-artifacts'],
    maximumRequestCost: input.maximumTotalCost,
    maximumTotalCost: input.maximumTotalCost,
    rightsPolicyVersion: 'storyforge-rights-v1',
    required: input.required,
  }
  return { ...body, capabilityHash: await hashProductProductionValueV2(body) }
}

export async function createTextOpenWorldCreatorProductionSourcePlanV1(input: {
  scope: WorkspaceScope
  productInstanceKey: string
  brief: TextOpenWorldCreatorBriefV1
  sourceLocator: TextOpenWorldCreatorSourceLocatorV1
  createdAt: number
}): Promise<TextOpenWorldCreatorProductionSourcePlanV1> {
  const scope = await resolveScope({ scope: input.scope })
  const brief = await verifyTextOpenWorldCreatorBriefV1(input.brief)
  const inspected = await inspectTextOpenWorldCreatorSourceLocatorV1({ scope, locator: input.sourceLocator })
  if (input.productInstanceKey !== brief.productInstanceKey
    || inspected.bindingHash !== brief.sourceBindingHash
    || !sameJson(inspected.binding, brief.sourceBinding)
    || !sameJson(inspected.summary, brief.sourceSummary)) {
    fail('Creator Brief 与当前来源 CAS 不一致')
  }
  let selection: TextOpenWorldCreatorProductionSourcePlanV1['selection']
  let expectedSourceBoundaryHash: string
  if (input.sourceLocator.kind === 'world-release') {
    const boundary = await prepareTextOpenWorldWorldSourceBoundaryV1({
      scope,
      localReleaseRecordId: input.sourceLocator.localReleaseRecordId,
      expectedReleaseHash: input.sourceLocator.expectedReleaseHash,
      selection: { mode: 'entire-release' },
    })
    selection = {
      kind: 'world-release',
      mode: 'entire-release',
      resourceKeys: boundary.selectedResourceKeys,
    }
    expectedSourceBoundaryHash = boundary.sourceBoundaryHash
  } else {
    const preview = await prepareTextOpenWorldNovelSourceSnapshotV1({
      sourceScope: scope,
      selection: input.sourceLocator.selection,
    })
    if (preview.sourceVersionHash !== input.sourceLocator.expectedSourceVersionHash
      || preview.sourceBoundaryHash !== input.sourceLocator.expectedSourceBoundaryHash) {
      fail('小说来源在计划生成前已变化')
    }
    selection = {
      kind: 'novel',
      mode: input.sourceLocator.selection.mode,
      sourceUnitCount: preview.sourceUnitCount,
      selectedChapterCount: preview.selection.selectedChapterCount,
      selectedOutlineCount: preview.selection.selectedOutlineCount,
    }
    expectedSourceBoundaryHash = preview.sourceBoundaryHash
  }
  const sourceVersionHash = brief.sourceBinding.kind === 'world-release'
    ? brief.sourceBinding.releaseHash
    : brief.sourceBinding.sourceVersionHash
  const count = selection.kind === 'world-release' ? selection.resourceKeys.length : selection.sourceUnitCount
  const body: Omit<TextOpenWorldCreatorProductionSourcePlanV1, 'planHash'> = {
    schema: 'storyforge.text-open-world-creator-production-source-plan',
    version: 1,
    productType: 'text-open-world',
    productInstanceKey: stableKey(input.productInstanceKey, 'productInstanceKey'),
    sourceKind: brief.sourceBinding.kind,
    sourceBinding: structuredClone(brief.sourceBinding),
    sourceBindingHash: brief.sourceBindingHash,
    sourceVersionHash,
    expectedSourceBoundaryHash,
    selection,
    sourceUnitArtifactKeys: sourceUnitArtifactKeys(count),
    createdAt: nonNegativeInteger(input.createdAt, 'createdAt'),
  }
  return { ...body, planHash: await hashProductProductionValueV2(body) }
}

export async function parseTextOpenWorldCreatorProductionSourcePlanV1(
  value: string | unknown,
  expectedBrief?: TextOpenWorldCreatorBriefV1,
): Promise<TextOpenWorldCreatorProductionSourcePlanV1> {
  let candidate: unknown = value
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate) } catch { fail('SourcePlan 不是合法 JSON') }
  }
  const row = record(candidate, 'sourcePlan')
  exactKeys(row, [
    'schema', 'version', 'productType', 'productInstanceKey', 'sourceKind', 'sourceBinding',
    'sourceBindingHash', 'sourceVersionHash', 'expectedSourceBoundaryHash', 'selection',
    'sourceUnitArtifactKeys', 'createdAt', 'planHash',
  ], 'sourcePlan')
  if (row.schema !== 'storyforge.text-open-world-creator-production-source-plan'
    || row.version !== 1 || row.productType !== 'text-open-world'
    || !['world-release', 'novel'].includes(String(row.sourceKind))) fail('SourcePlan schema/version/kind 无效')
  const selection = record(row.selection, 'sourcePlan.selection')
  let parsedSelection: TextOpenWorldCreatorProductionSourcePlanV1['selection']
  if (selection.kind === 'world-release') {
    exactKeys(selection, ['kind', 'mode', 'resourceKeys'], 'sourcePlan.selection')
    if (selection.mode !== 'entire-release' || !Array.isArray(selection.resourceKeys)
      || selection.resourceKeys.length < 1 || selection.resourceKeys.length > MAX_SOURCE_UNITS) {
      fail('WorldRelease selection 无效')
    }
    const resourceKeys = selection.resourceKeys.map((item, index) => stableKey(item, 'resourceKeys[' + index + ']'))
    if (new Set(resourceKeys).size !== resourceKeys.length) fail('WorldRelease resourceKeys 重复')
    parsedSelection = { kind: 'world-release', mode: 'entire-release', resourceKeys }
  } else if (selection.kind === 'novel') {
    exactKeys(selection, ['kind', 'mode', 'sourceUnitCount', 'selectedChapterCount', 'selectedOutlineCount'], 'sourcePlan.selection')
    if (!['entire-work', 'outline-subtree', 'chapter-range', 'chapters'].includes(String(selection.mode))) {
      fail('小说 selection.mode 无效')
    }
    parsedSelection = {
      kind: 'novel',
      mode: selection.mode as Extract<TextOpenWorldCreatorProductionSourcePlanV1['selection'], { kind: 'novel' }>['mode'],
      sourceUnitCount: positiveInteger(selection.sourceUnitCount, 'sourceUnitCount'),
      selectedChapterCount: nonNegativeInteger(selection.selectedChapterCount, 'selectedChapterCount'),
      selectedOutlineCount: nonNegativeInteger(selection.selectedOutlineCount, 'selectedOutlineCount'),
    }
  } else fail('SourcePlan selection.kind 无效')
  const count = parsedSelection.kind === 'world-release'
    ? parsedSelection.resourceKeys.length
    : parsedSelection.sourceUnitCount
  if (!Array.isArray(row.sourceUnitArtifactKeys)
    || !sameJson(row.sourceUnitArtifactKeys, sourceUnitArtifactKeys(count))) {
    fail('SourcePlan 来源 Artifact keys 与选择数量不闭合')
  }
  if (!isSha256Hash(row.expectedSourceBoundaryHash)) {
    fail('expectedSourceBoundaryHash 无效')
  }
  const parsed: TextOpenWorldCreatorProductionSourcePlanV1 = {
    schema: 'storyforge.text-open-world-creator-production-source-plan',
    version: 1,
    productType: 'text-open-world',
    productInstanceKey: stableKey(row.productInstanceKey, 'productInstanceKey'),
    sourceKind: row.sourceKind as TextOpenWorldCreatorProductionSourcePlanV1['sourceKind'],
    sourceBinding: structuredClone(row.sourceBinding) as TextOpenWorldCreatorProductionSourcePlanV1['sourceBinding'],
    sourceBindingHash: hash(row.sourceBindingHash, 'sourceBindingHash'),
    sourceVersionHash: hash(row.sourceVersionHash, 'sourceVersionHash'),
    expectedSourceBoundaryHash: row.expectedSourceBoundaryHash as string,
    selection: parsedSelection,
    sourceUnitArtifactKeys: sourceUnitArtifactKeys(count),
    createdAt: nonNegativeInteger(row.createdAt, 'createdAt'),
    planHash: hash(row.planHash, 'planHash'),
  }
  const { planHash, ...body } = parsed
  if (await hashProductProductionValueV2(body) !== planHash) fail('SourcePlan Hash 不匹配')
  if (parsed.sourceKind !== parsed.selection.kind) {
    fail('SourcePlan 来源种类与选择不闭合')
  }
  if (expectedBrief) {
    const brief = await verifyTextOpenWorldCreatorBriefV1(expectedBrief)
    const versionHash = brief.sourceBinding.kind === 'world-release'
      ? brief.sourceBinding.releaseHash : brief.sourceBinding.sourceVersionHash
    if (parsed.productInstanceKey !== brief.productInstanceKey
      || parsed.sourceKind !== brief.sourceBinding.kind
      || parsed.sourceBindingHash !== brief.sourceBindingHash
      || parsed.sourceVersionHash !== versionHash
      || !sameJson(parsed.sourceBinding, brief.sourceBinding)) fail('SourcePlan 与 Creator Brief 不一致')
  }
  return parsed
}

/** Build the shared scheduler envelope without replacing the Creator Brief. */
export async function createTextOpenWorldCreatorExecutionBriefV1(input: {
  brief: TextOpenWorldCreatorBriefV1
  sourcePlan: TextOpenWorldCreatorProductionSourcePlanV1
  productionBudget: TextOpenWorldCreatorProductionPreflightV1['estimate']
}): Promise<ProductProductionBriefV3> {
  const brief = await verifyTextOpenWorldCreatorBriefV1(input.brief)
  const sourcePlan = await parseTextOpenWorldCreatorProductionSourcePlanV1(input.sourcePlan, brief)
  const selectionKey = planSelectionKey(sourcePlan.sourceBindingHash)
  const requiredPlayMinutes = Math.round(
    (brief.draft.scale.requiredPlayMinutes.minimum + brief.draft.scale.requiredPlayMinutes.maximum) / 2,
  )
  const requiredImageCount = brief.draft.scale.namedLocations.maximum
    + TEXT_OPEN_WORLD_REQUIRED_KEY_PORTRAIT_COUNT_V1
  const textCapability = await capabilityRequirement({
    requirementKey: 'text-open-world.production.text.v1',
    mediaClass: 'text',
    required: true,
    maximumTotalCost: input.productionBudget.maximumCostUsd,
  })
  const imageCapability = await capabilityRequirement({
    // Reuse the shared media transport's stable visual capability coordinate.
    // The Creator Start still owns the zero-cost/procedural policy below.
    requirementKey: 'media.visual',
    mediaClass: 'image',
    required: false,
    maximumTotalCost: 0,
  })
  return parseProductProductionBriefV3({
    schema: 'storyforge.product-production-brief',
    version: 3,
    source: {
      // Scheduler compatibility coordinate only. It must stay portable and
      // must never be interpreted as a local WorldRelease/Work locator. P0/P1
      // always use the dedicated SourcePlan plus remappable locator columns.
      worldReleaseId: 1,
      worldContentHash: sourcePlan.sourceVersionHash,
      selection: {
        schema: 'storyforge.product-world-source-selection',
        version: 1,
        productType: 'text-open-world',
        worldReferenceHash: sourcePlan.sourceBindingHash,
        resourceKeys: [selectionKey],
        roleBindings: {},
      },
      startingPoint: {
        kind: 'custom',
        title: brief.draft.gameTitle,
        summary: brief.draft.playerFantasy,
        sourceRefs: [selectionKey],
        protagonistRefs: [],
        openingConflict: brief.draft.openingSituation,
      },
    },
    intent: {
      productType: 'text-open-world',
      playerRole: brief.draft.playerRole,
      protagonistRefs: [],
      openingSituation: brief.draft.openingSituation,
      coreExperience: [...new Set([
        brief.draft.playerFantasy,
        brief.draft.coreGoal,
        ...brief.draft.experiencePillars,
      ])],
      requiredFacts: [...brief.draft.mustKeep],
      forbiddenChanges: [...new Set([
        ...brief.draft.forbiddenChanges,
        ...(brief.productBoundary.criticalActorsProtected
          ? ['关键角色不得被生产为可永久破坏的主线阻断点'] : []),
        ...(brief.productBoundary.criticalItemsProtected
          ? ['关键道具不得被生产为可永久丢失的主线阻断点'] : []),
      ])],
      contentBoundaries: [...new Set([
        '内容分级：' + brief.draft.contentRating,
        ...brief.draft.contentBoundaries,
      ])],
      tone: [...brief.draft.toneKeywords],
    },
    scale: {
      scope: 'campaign',
      targetPlayMinutes: requiredPlayMinutes,
      targetWordCount: Math.max(10_000, requiredPlayMinutes * 180),
      targetEndingCount: brief.draft.scale.endings,
    },
    media: {
      visualLevel: 'key-scenes',
      audioLevel: 'none',
      imageCount: requiredImageCount,
      musicTrackCount: 0,
      sfxCount: 0,
      voiceLineCount: 0,
      requiredMediaKinds: ['background', 'character-pose'],
    },
    consultationBudget: {
      maximumModelCalls: 0,
      maximumInputTokens: 0,
      maximumOutputTokens: 0,
      maximumCostUsd: 0,
    },
    productionBudget: {
      maximumModelCalls: input.productionBudget.maximumModelCalls,
      maximumInputTokens: input.productionBudget.reservedInputTokens,
      maximumOutputTokens: input.productionBudget.reservedOutputTokens,
      maximumCostUsd: input.productionBudget.maximumCostUsd,
      maximumMediaCalls: requiredImageCount,
      maximumDurationMs: input.productionBudget.maximumDurationMs,
      maximumStorageBytes: input.productionBudget.maximumStorageBytes,
    },
    qualityProfile: 'prototype',
    capabilityRequirements: [textCapability, imageCapability],
    externalDataPolicy: {
      allowedDataClasses: ['creator-brief', 'frozen-source-plan', 'accepted-build-artifacts'],
      forbiddenDataClasses: ['provider-credential', 'world-engine-mutable-state', 'player-private-session'],
      allowReferenceImages: false,
      allowVoiceScripts: false,
    },
    fallbackPolicy: {
      allowTextOnly: false,
      allowExistingProjectMedia: true,
      allowProceduralAudio: true,
      onRequiredCapabilityMissing: 'pause',
    },
    completionContract: {
      requiresPlayablePreview: true,
      requiredGateIds: ['runtime.package.valid', 'runtime.playable', 'rights.complete'],
      minimumMediaCoverage: 1,
      allowSoftWaivers: false,
    },
    unresolvedDecisionKeys: [],
  })
}

export async function parseTextOpenWorldCreatorProductionStartV1(input: {
  value: string | unknown
  brief?: TextOpenWorldCreatorBriefV1
  sourcePlan?: TextOpenWorldCreatorProductionSourcePlanV1
  productionPlan?: ProductProductionPlanV3 | string
}): Promise<TextOpenWorldCreatorProductionStartV1> {
  let candidate: unknown = input.value
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate) } catch { fail('Start 不是合法 JSON') }
  }
  const row = record(candidate, 'start')
  exactKeys(row, [
    'schema', 'version', 'productType', 'productInstanceKey', 'briefRevision', 'briefHash',
    'sourceBindingHash', 'sourcePlanHash', 'preflight', 'confirmation', 'executionBrief',
    'executionBriefHash', 'productionPlanControlEpoch', 'productionPlanHash',
    'authorStartRevision', 'authorizationNonceHash',
    'rightsBasis', 'rightsNote', 'authorizedAt', 'startHash',
  ], 'start')
  if (row.schema !== 'storyforge.text-open-world-creator-production-start'
    || row.version !== 1 || row.productType !== 'text-open-world') fail('Start schema/version/product 无效')
  const executionBrief = parseProductProductionBriefV3(row.executionBrief)
  const executionBriefHash = hash(row.executionBriefHash, 'executionBriefHash')
  if (await hashProductProductionValueV2(executionBrief) !== executionBriefHash) {
    fail('executionBriefHash 不匹配')
  }
  const preflight = structuredClone(row.preflight) as TextOpenWorldCreatorProductionPreflightV1
  const confirmation = structuredClone(row.confirmation) as TextOpenWorldCreatorProductionPreflightConfirmationV1
  if (!await nestedHashValid(preflight, 'preflightHash', 'storyforge.text-open-world-creator-production-preflight')
    || !await nestedHashValid(preflight.providerBinding, 'bindingHash', 'storyforge.text-open-world-creator-provider-binding')
    || !await nestedHashValid(preflight.priceQuote, 'quoteHash', 'storyforge.text-open-world-creator-price-quote')
    || !await nestedHashValid(preflight.estimate, 'estimateHash', 'storyforge.text-open-world-creator-production-estimate')
    || !await nestedHashValid(confirmation, 'confirmationHash', 'storyforge.text-open-world-creator-production-preflight-confirmation')) {
    fail('Start 内的生产准备快照 Hash 无效')
  }
  if (preflight.ready !== true || !Array.isArray(preflight.blockers) || preflight.blockers.length !== 0
    || !preflight.priceQuote || !confirmation.acknowledgement
    || Object.values(confirmation.acknowledgement).some(value => value !== true)) {
    fail('Start 内的生产准备快照没有完成授权')
  }
  const rightsBasis = row.rightsBasis as TextOpenWorldSourceRightsBasisV1
  if (!['author-owned', 'licensed', 'public-domain'].includes(rightsBasis)) fail('rightsBasis 无效')
  const parsed: TextOpenWorldCreatorProductionStartV1 = {
    schema: 'storyforge.text-open-world-creator-production-start',
    version: 1,
    productType: 'text-open-world',
    productInstanceKey: stableKey(row.productInstanceKey, 'productInstanceKey'),
    briefRevision: positiveInteger(row.briefRevision, 'briefRevision'),
    briefHash: hash(row.briefHash, 'briefHash'),
    sourceBindingHash: hash(row.sourceBindingHash, 'sourceBindingHash'),
    sourcePlanHash: hash(row.sourcePlanHash, 'sourcePlanHash'),
    preflight,
    confirmation,
    executionBrief,
    executionBriefHash,
    productionPlanControlEpoch: nonNegativeInteger(
      row.productionPlanControlEpoch,
      'productionPlanControlEpoch',
    ),
    productionPlanHash: hash(row.productionPlanHash, 'productionPlanHash'),
    authorStartRevision: nonNegativeInteger(row.authorStartRevision, 'authorStartRevision'),
    authorizationNonceHash: hash(row.authorizationNonceHash, 'authorizationNonceHash'),
    rightsBasis,
    rightsNote: normalizedText(row.rightsNote, 'rightsNote', 2_000),
    authorizedAt: nonNegativeInteger(row.authorizedAt, 'authorizedAt'),
    startHash: hash(row.startHash, 'startHash'),
  }
  const { startHash, ...body } = parsed
  if (await hashProductProductionValueV2(body) !== startHash) fail('Start Hash 不匹配')
  if (preflight.productInstanceKey !== parsed.productInstanceKey
    || preflight.briefHash !== parsed.briefHash
    || preflight.sourceBindingHash !== parsed.sourceBindingHash
    || confirmation.productInstanceKey !== parsed.productInstanceKey
    || confirmation.briefHash !== parsed.briefHash
    || confirmation.providerBindingHash !== preflight.providerBinding.bindingHash
    || confirmation.priceQuoteHash !== preflight.priceQuote.quoteHash
    || confirmation.estimateHash !== preflight.estimate.estimateHash) {
    fail('Start 的 Brief、来源、模型、报价或预算链不闭合')
  }
  if (input.brief) {
    const brief = await verifyTextOpenWorldCreatorBriefV1(input.brief)
    if (parsed.productInstanceKey !== brief.productInstanceKey
      || parsed.briefRevision !== brief.revision || parsed.briefHash !== brief.briefHash
      || parsed.sourceBindingHash !== brief.sourceBindingHash) fail('Start 与 Creator Brief 不一致')
  }
  if (input.sourcePlan) {
    const sourcePlan = await parseTextOpenWorldCreatorProductionSourcePlanV1(input.sourcePlan, input.brief)
    if (parsed.sourcePlanHash !== sourcePlan.planHash) fail('Start 与 SourcePlan 不一致')
  }
  if (input.productionPlan) {
    const plan = parseProductProductionPlanV3(input.productionPlan, executionBrief, parsed.briefHash)
    if (plan.controlEpoch !== parsed.productionPlanControlEpoch
      || await hashProductProductionValueV2(plan) !== parsed.productionPlanHash) {
      fail('Start 与生产 Plan 不一致')
    }
  }
  return parsed
}

export interface TextOpenWorldCreatorStartPreparationV1 {
  scope: WorkspaceScope
  production: ProductProductionRecordV1 & { id: number }
  briefRow: ProductProductionBriefRecordV1 & { id: number }
  brief: TextOpenWorldCreatorBriefV1
  sourcePlan: TextOpenWorldCreatorProductionSourcePlanV1
  start: TextOpenWorldCreatorProductionStartV1
  plan: ProductProductionPlanV3
  buildNumber: number
  novelSourceCasWitness: TextOpenWorldNovelSourceCasWitnessV1 | null
}

export async function createTextOpenWorldCreatorStartPreparationV1(input: {
  scope: WorkspaceScope
  productionId: number
  briefRevision: number
  briefHash: string
  expectedStateRevision: number
  sourceLocator: TextOpenWorldCreatorSourceLocatorV1
  preflight: TextOpenWorldCreatorProductionPreflightV1
  confirmation: TextOpenWorldCreatorProductionPreflightConfirmationV1
  aiConfig: AIConfig
  rememberApiKey: boolean
  rightsBasis: TextOpenWorldSourceRightsBasisV1
  rightsNote: string
  authorizationNonce: string
  authorizedAt?: number
}): Promise<TextOpenWorldCreatorStartPreparationV1> {
  const scope = await resolveScope({ scope: input.scope })
  const production = await db.productProductions.get(input.productionId)
  if (!production?.id
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || production.productType !== 'text-open-world') fail('Production 不存在、跨 Work 或产品类型错误')
  if (production.status !== 'brief-ready' || production.stateRevision !== input.expectedStateRevision
    || production.currentBriefRevision !== input.briefRevision || production.currentBuildNumber != null) {
    fail('Production 已变化或不在可授权状态')
  }
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([production.id, input.briefRevision]).first()
  if (!briefRow?.id || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.briefKind !== 'text-open-world-creator-v1' || briefRow.status !== 'draft'
    || briefRow.briefHash !== input.briefHash || briefRow.sourceBindingHash !== production.creatorSourceBindingHash) {
    fail('当前 Creator Brief 已变化或不可授权')
  }
  const brief = await verifyTextOpenWorldCreatorBriefV1(briefRow.briefJson)
  if (brief.revision !== briefRow.revision || brief.briefHash !== briefRow.briefHash
    || brief.productInstanceKey !== production.productionKey) fail('Creator Brief 行与内容不一致')
  const verifiedConfirmation = await verifyTextOpenWorldCreatorProductionPreflightConfirmationV1({
    brief,
    preflight: input.preflight,
    confirmation: input.confirmation,
    projectId: scope.projectId,
    aiConfig: input.aiConfig,
    rememberApiKey: input.rememberApiKey,
  })
  const authorizedAt = input.authorizedAt ?? Date.now()
  if (!Number.isSafeInteger(authorizedAt) || authorizedAt < verifiedConfirmation.confirmedAt
    || authorizedAt > Date.now() + 60_000) fail('authorizedAt 无效')
  const rightsNote = normalizedText(input.rightsNote, 'rightsNote', 2_000)
  if (!['author-owned', 'licensed', 'public-domain'].includes(input.rightsBasis)) fail('rightsBasis 无效')
  const authorizationNonce = normalizedText(input.authorizationNonce, 'authorizationNonce', 500)
  const sourcePlan = await createTextOpenWorldCreatorProductionSourcePlanV1({
    scope,
    productInstanceKey: production.productionKey,
    brief,
    sourceLocator: input.sourceLocator,
    createdAt: authorizedAt,
  })
  const novelSourceCasWitness = input.sourceLocator.kind === 'novel'
    ? await createTextOpenWorldNovelSourceCasWitnessV1({
        sourceScope: scope,
        selection: input.sourceLocator.selection,
        expectedSourceVersionHash: input.sourceLocator.expectedSourceVersionHash,
        expectedSourceBoundaryHash: input.sourceLocator.expectedSourceBoundaryHash,
      })
    : null
  const executionBrief = await createTextOpenWorldCreatorExecutionBriefV1({
    brief,
    sourcePlan,
    productionBudget: input.preflight.estimate,
  })
  const executionBriefHash = await hashProductProductionValueV2(executionBrief)
  const rows = await db.productBuilds.where('productionId').equals(production.id).toArray()
  const buildNumber = Math.max(0, ...rows.map(row => row.buildNumber)) + 1
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber,
    controlEpoch: production.controlEpoch,
    brief: executionBrief,
    briefHash: executionBriefHash,
    authoritativeBriefHash: brief.briefHash,
    sourceUnitArtifactKeys: sourcePlan.sourceUnitArtifactKeys,
    // WorldRelease P0 stores index-only unit payloads. Novel source text stays
    // private inside the source adapter, so reserve its accepted 4M-char safety
    // boundary instead of underestimating from the word-count-only summary.
    sourceTotalChars: sourcePlan.sourceKind === 'world-release' ? 0 : MAX_SOURCE_TOTAL_CHARS,
    mediaCostAuthorized: false,
  })
  const productionPlanHash = await hashProductProductionValueV2(plan)
  const authorizationNonceHash = await hashProductProductionValueV2({
    authorizationNonce,
    productInstanceKey: production.productionKey,
    briefRevision: brief.revision,
    briefHash: brief.briefHash,
    sourcePlanHash: sourcePlan.planHash,
    authorStartRevision: input.expectedStateRevision,
  })
  const body: Omit<TextOpenWorldCreatorProductionStartV1, 'startHash'> = {
    schema: 'storyforge.text-open-world-creator-production-start',
    version: 1,
    productType: 'text-open-world',
    productInstanceKey: production.productionKey,
    briefRevision: brief.revision,
    briefHash: brief.briefHash,
    sourceBindingHash: brief.sourceBindingHash,
    sourcePlanHash: sourcePlan.planHash,
    preflight: structuredClone(input.preflight),
    confirmation: structuredClone(verifiedConfirmation),
    executionBrief,
    executionBriefHash,
    productionPlanControlEpoch: plan.controlEpoch,
    productionPlanHash,
    authorStartRevision: input.expectedStateRevision,
    authorizationNonceHash,
    rightsBasis: input.rightsBasis,
    rightsNote,
    authorizedAt,
  }
  const start = await parseTextOpenWorldCreatorProductionStartV1({
    value: { ...body, startHash: await hashProductProductionValueV2(body) },
    brief,
    sourcePlan,
    productionPlan: plan,
  })
  return {
    scope,
    production: production as ProductProductionRecordV1 & { id: number },
    briefRow: briefRow as ProductProductionBriefRecordV1 & { id: number },
    brief,
    sourcePlan,
    start,
    plan,
    buildNumber,
    novelSourceCasWitness,
  }
}

/** Read the compatibility Brief only after proving the Creator start chain. */
export async function readTextOpenWorldCreatorExecutionBriefV1(input: {
  briefRow: ProductProductionBriefRecordV1
  planJson?: ProductProductionPlanV3 | string
}): Promise<{
  creatorBrief: TextOpenWorldCreatorBriefV1
  sourcePlan: TextOpenWorldCreatorProductionSourcePlanV1
  start: TextOpenWorldCreatorProductionStartV1
  executionBrief: ProductProductionBriefV3
}> {
  if (input.briefRow.briefKind !== 'text-open-world-creator-v1'
    || input.briefRow.status !== 'authorized') fail('Brief 不是已授权 Creator Brief')
  const creatorBrief = await verifyTextOpenWorldCreatorBriefV1(input.briefRow.briefJson)
  if (creatorBrief.briefHash !== input.briefRow.briefHash) fail('Creator Brief 行 Hash 不匹配')
  const sourcePlan = await parseTextOpenWorldCreatorProductionSourcePlanV1(
    input.briefRow.sourcePlanJson,
    creatorBrief,
  )
  if (sourcePlan.planHash !== input.briefRow.sourcePlanHash) fail('SourcePlan 行 Hash 不匹配')
  const start = await parseTextOpenWorldCreatorProductionStartV1({
    value: input.briefRow.confirmedBriefJson,
    brief: creatorBrief,
    sourcePlan,
  })
  if (start.startHash !== input.briefRow.confirmedBriefHash) fail('Start 行 Hash 不匹配')
  if (input.planJson) {
    const currentPlan = parseProductProductionPlanV3(
      input.planJson,
      start.executionBrief,
      creatorBrief.briefHash,
    )
    if (currentPlan.controlEpoch < start.productionPlanControlEpoch) {
      fail('当前生产 Plan epoch 早于作者授权 Plan')
    }
    const authorAuthorizedPlan = {
      ...currentPlan,
      controlEpoch: start.productionPlanControlEpoch,
    }
    if (await hashProductProductionValueV2(authorAuthorizedPlan) !== start.productionPlanHash) {
      fail('当前生产 Plan 改动了作者授权 DAG 或预算')
    }
  }
  return { creatorBrief, sourcePlan, start, executionBrief: start.executionBrief }
}
