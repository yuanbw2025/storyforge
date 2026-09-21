import type {
  ProductProductionBriefV3,
  ProductProductionPlanTaskV3,
  ProductProductionPlanV3,
  ProductTaskBudgetReservationV1,
} from '../types'
import { PRODUCTION_PRODUCT_KINDS_V1 } from '../types'
import { parseProductProductionBriefV3 } from './contracts'
import { hashProductProductionValueV2, isSha256Hash } from './hash'
import { textAdventureSceneScriptPartSceneKeysV1 } from '../adventure/scene-script'
import {
  TEXT_ADVENTURE_QUALITY_REVIEW_SCOPES_V1,
  type TextAdventureQualityReviewScopeV1,
} from '../adventure/production-artifacts'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const LANES = ['planning', 'content', 'visual', 'audio', 'integration', 'qa'] as const
const EXECUTION_MODES = ['deterministic', 'model', 'media-provider', 'human-import'] as const
const FAILURE_POLICIES = ['fail-build', 'pause', 'fallback', 'skip-optional'] as const
// Each commercial review Run owns exactly one frozen image. Live
// OpenAI-compatible vision providers repeatedly returned only the first item
// from two-image JSON batches, leaving the second image without evidence.
// One image per Run keeps retries, receipts, budgets and repair lineage
// truthful instead of treating provider batch cardinality as a prompt concern.
export const TEXT_ADVENTURE_VISUAL_REVIEW_BATCH_SIZE_V1 = 1

export type TextAdventureQualityReviewTaskKeyV1 =
  `content.adventure-quality-review.${TextAdventureQualityReviewScopeV1}`
export type TextAdventureQualityReviewBatchArtifactKeyV1 =
  `quality.adventure-review.${TextAdventureQualityReviewScopeV1}`

export function textAdventureQualityReviewTaskKeyV1(
  scope: TextAdventureQualityReviewScopeV1,
): TextAdventureQualityReviewTaskKeyV1 {
  return `content.adventure-quality-review.${scope}`
}

export function textAdventureQualityReviewBatchArtifactKeyV1(
  scope: TextAdventureQualityReviewScopeV1,
): TextAdventureQualityReviewBatchArtifactKeyV1 {
  return `quality.adventure-review.${scope}`
}

export function textAdventureQualityReviewScopeFromTaskKeyV1(
  taskKey: string,
): TextAdventureQualityReviewScopeV1 | null {
  return TEXT_ADVENTURE_QUALITY_REVIEW_SCOPES_V1.find(scope => (
    taskKey === textAdventureQualityReviewTaskKeyV1(scope)
  )) ?? null
}

export function textAdventureQualityReviewBatchTaskKeysV1(): TextAdventureQualityReviewTaskKeyV1[] {
  return TEXT_ADVENTURE_QUALITY_REVIEW_SCOPES_V1.map(textAdventureQualityReviewTaskKeyV1)
}

export function textAdventureVisualReviewArtifactBatchesV1(
  artifactKeys: readonly string[],
): string[][] {
  const batches = Array.from(
    { length: Math.ceil(artifactKeys.length / TEXT_ADVENTURE_VISUAL_REVIEW_BATCH_SIZE_V1) },
    (_, index) => [...artifactKeys.slice(
      index * TEXT_ADVENTURE_VISUAL_REVIEW_BATCH_SIZE_V1,
      (index + 1) * TEXT_ADVENTURE_VISUAL_REVIEW_BATCH_SIZE_V1,
    )],
  )
  // Commercial illustration sets put the final regional/map and turning-point
  // assets at the tail. Live provider evidence showed that reviewing those two
  // semantically dense images together repeatedly broke the output contract.
  // Preserve the successful earlier pairs and give the last two independent
  // receipts instead of invalidating the whole visual QA set.
  const tail = batches[batches.length - 1]
  if (artifactKeys.length >= 12 && tail?.length === 2) {
    batches.splice(-1, 1, [tail[0]], [tail[1]])
  }
  return batches
}

export interface TextAdventureProductionBudgetFloorV1 {
  modelTaskCount: number
  retryReserveSlots: number
  minimumModelCalls: number
  minimumInputTokens: number
  minimumOutputTokens: number
  minimumDurationMs: number
}

/**
 * Returns the smallest production envelope that can truthfully admit the
 * current professional text-adventure DAG. Provider receipts may include
 * hidden reasoning tokens, so a commercial Build also needs explicit retry
 * and output headroom instead of authorizing exactly one call per model task.
 */
export function textAdventureProductionBudgetFloorV1(
  brief: ProductProductionBriefV3,
): TextAdventureProductionBudgetFloorV1 {
  if (brief.intent.productType !== 'text-adventure' || !brief.textAdventure) {
    throw new Error('[product-production-plan] 预算底线只适用于文字冒险 Brief')
  }
  const activeVisual = brief.media.imageCount > 0
    || brief.capabilityRequirements.some(requirement => requirement.mediaClass === 'image')
  const sceneScriptPartCount = [0, 1, 2].reduce((sum, actIndex) => (
    sum + textAdventureSceneScriptPartSceneKeysV1(brief, actIndex).length
  ), 0)
  const visualAssetCount = activeVisual ? Math.max(1, brief.media.imageCount) : 0
  const visualReviewBatchCount = textAdventureVisualReviewArtifactBatchesV1(
    Array.from({ length: visualAssetCount }, (_, index) => String(index)),
  ).length
  // Four bounded professional review Runs replace the former single
  // whole-product review (+3 net model calls). Their public scorecard is
  // assembled by a separate deterministic task below.
  const modelTaskCount = 29 + sceneScriptPartCount + visualReviewBatchCount + Number(activeVisual)
  // A complete commercial run exercises many deep structured schemas. Live
  // provider evidence showed that half-pipeline retry headroom was exhausted
  // before the remaining prose/editing Runs could even be admitted. Reserve
  // one bounded recovery slot per model task: attempts remain capped per task,
  // while the Build ledger still rejects every call beyond this hard total.
  // A complete flagship rehearsal consumed 64 calls before the final
  // dialogue pass could be accepted, leaving continuity, media direction,
  // visual QA and playtest planning unstarted. Reserve 1.5 recovery calls per
  // specialist so the author-approved envelope can finish the whole team,
  // rather than silently dropping late quality roles.
  const retryReserveSlots = Math.max(48, Math.ceil(modelTaskCount * 1.5))
  const minimumModelCalls = modelTaskCount + retryReserveSlots
  return {
    modelTaskCount,
    retryReserveSlots,
    minimumModelCalls,
    // Real commercial repair evidence reached 1,915,599 input tokens after
    // 109 settled/failed model calls (~17.6k per call) while a substantial
    // downstream closure was still pending. Exact registered Brief and
    // artifact packets on the current mainline also exceed the former 24k
    // generic slice before provider framing. Reserve 32k per admitted call so
    // the author-approved child Build can finish; actual usage remains the
    // append-only scheduler authority.
    minimumInputTokens: Math.max(300_000, minimumModelCalls * 32_000),
    minimumOutputTokens: Math.max(
      100_000,
      brief.scale.targetWordCount * 8 + 60_000,
      brief.scale.targetPlayMinutes * 2_000 + 40_000,
      // Completion receipts can include hidden reasoning in addition to the
      // visible JSON. Size the lifetime envelope for admitted attempts rather
      // than only successful task count; task-local ceilings remain fixed
      // below and therefore cannot inflate one response to consume the pool.
      minimumModelCalls * 8_000,
    ),
    // The full professional DAG includes long-form scene writers and
    // provider-native visual reviews. Five hours is a Build-lifetime sum of
    // task receipts, not five hours of wall-clock latency; independent Runs
    // still execute concurrently and retain their own shorter timeouts.
    minimumDurationMs: Math.max(18_000_000, modelTaskCount * 360_000),
  }
}

function fail(message: string): never { throw new Error(`[product-production-plan] ${message}`) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    fail(`${label} 字段不精确:${actual.join(',')}`)
  }
}
function key(value: unknown, label: string): string {
  if (typeof value !== 'string' || !STABLE_KEY.test(value)) fail(`${label} 不是稳定 key`)
  return value
}
function integer(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > maximum) fail(`${label} 必须是有界非负整数`)
  return Number(value)
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label} 枚举无效`)
  return value as T
}
function keys(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 1_000) fail(`${label} 必须是有界数组`)
  const parsed = value.map((item, index) => key(item, `${label}[${index}]`))
  if (new Set(parsed).size !== parsed.length) fail(`${label} 不允许重复`)
  return parsed
}
function nullableCost(value: unknown, label: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) fail(`${label} 无效`)
  return value
}

function parseBudget(value: unknown, label: string): ProductTaskBudgetReservationV1 {
  const row = record(value, label)
  exactKeys(row, ['modelCalls', 'inputTokens', 'outputTokens', 'mediaCalls', 'maximumCostUsd', 'durationMs', 'storageBytes'], label)
  return {
    modelCalls: integer(row.modelCalls, `${label}.modelCalls`, 100_000),
    inputTokens: integer(row.inputTokens, `${label}.inputTokens`, 1_000_000_000),
    outputTokens: integer(row.outputTokens, `${label}.outputTokens`, 1_000_000_000),
    mediaCalls: integer(row.mediaCalls, `${label}.mediaCalls`, 100_000),
    maximumCostUsd: nullableCost(row.maximumCostUsd, `${label}.maximumCostUsd`),
    durationMs: integer(row.durationMs, `${label}.durationMs`, 31_536_000_000),
    storageBytes: integer(row.storageBytes, `${label}.storageBytes`, 1_000_000_000_000),
  }
}

function parseTask(value: unknown, index: number): ProductProductionPlanTaskV3 {
  const label = `tasks[${index}]`
  const row = record(value, label)
  exactKeys(row, [
    'taskKey', 'lane', 'kind', 'skillId', 'executionMode', 'dependsOn', 'requiredReceipts',
    'inputArtifactKeys', 'outputArtifactKeys', 'requirementKeys', 'capabilityRequirementKeys',
    'concurrencyGroup', 'subjectLockKeys', 'priority', 'budgetReservation', 'maxAttempts',
    'timeoutMs', 'failurePolicy', 'fallbackTaskKey', 'acceptanceGateIds', 'reuse',
  ], label)
  if (!Array.isArray(row.requiredReceipts) || row.requiredReceipts.length > 1_000) fail(`${label}.requiredReceipts 无效`)
  const requiredReceipts = row.requiredReceipts.map((value, receiptIndex) => {
    const receipt = record(value, `${label}.requiredReceipts[${receiptIndex}]`)
    exactKeys(receipt, ['taskKey', 'receiptHash'], `${label}.requiredReceipts[${receiptIndex}]`)
    if (receipt.receiptHash !== null && !isSha256Hash(receipt.receiptHash)) fail(`${label}.receiptHash 无效`)
    return { taskKey: key(receipt.taskKey, `${label}.receipt.taskKey`), receiptHash: receipt.receiptHash as string | null }
  })
  let reuse: ProductProductionPlanTaskV3['reuse'] = null
  if (row.reuse != null) {
    const candidate = record(row.reuse, `${label}.reuse`)
    exactKeys(candidate, [
      'sourceBuildNumber', 'sourceArtifactKey', 'sourceContentHash', 'reuseKey',
      'requiresRevalidation', 'reason',
    ], `${label}.reuse`)
    if (!isSha256Hash(candidate.sourceContentHash) || !isSha256Hash(candidate.reuseKey)
      || typeof candidate.requiresRevalidation !== 'boolean'
      || typeof candidate.reason !== 'string' || !candidate.reason.trim()) {
      fail(`${label}.reuse 无效`)
    }
    reuse = {
      sourceBuildNumber: integer(candidate.sourceBuildNumber, `${label}.reuse.sourceBuildNumber`),
      sourceArtifactKey: key(candidate.sourceArtifactKey, `${label}.reuse.sourceArtifactKey`),
      sourceContentHash: candidate.sourceContentHash,
      reuseKey: candidate.reuseKey,
      requiresRevalidation: candidate.requiresRevalidation,
      reason: candidate.reason.trim(),
    }
  }
  return {
    taskKey: key(row.taskKey, `${label}.taskKey`),
    lane: enumValue(row.lane, LANES, `${label}.lane`),
    kind: key(row.kind, `${label}.kind`),
    skillId: row.skillId === null ? null : key(row.skillId, `${label}.skillId`),
    executionMode: enumValue(row.executionMode, EXECUTION_MODES, `${label}.executionMode`),
    dependsOn: keys(row.dependsOn, `${label}.dependsOn`),
    requiredReceipts,
    inputArtifactKeys: keys(row.inputArtifactKeys, `${label}.inputArtifactKeys`),
    outputArtifactKeys: keys(row.outputArtifactKeys, `${label}.outputArtifactKeys`),
    requirementKeys: keys(row.requirementKeys, `${label}.requirementKeys`),
    capabilityRequirementKeys: keys(row.capabilityRequirementKeys, `${label}.capabilityRequirementKeys`),
    concurrencyGroup: key(row.concurrencyGroup, `${label}.concurrencyGroup`),
    subjectLockKeys: keys(row.subjectLockKeys, `${label}.subjectLockKeys`),
    priority: integer(row.priority, `${label}.priority`, 1_000_000),
    budgetReservation: parseBudget(row.budgetReservation, `${label}.budgetReservation`),
    maxAttempts: integer(row.maxAttempts, `${label}.maxAttempts`, 20),
    timeoutMs: integer(row.timeoutMs, `${label}.timeoutMs`, 86_400_000),
    failurePolicy: enumValue(row.failurePolicy, FAILURE_POLICIES, `${label}.failurePolicy`),
    fallbackTaskKey: row.fallbackTaskKey === null ? null : key(row.fallbackTaskKey, `${label}.fallbackTaskKey`),
    acceptanceGateIds: keys(row.acceptanceGateIds, `${label}.acceptanceGateIds`),
    reuse,
  }
}

export function parseProductProductionPlanV3(
  value: string | unknown,
  briefInput?: ProductProductionBriefV3 | string,
  expectedBriefHash?: string,
): ProductProductionPlanV3 {
  let candidate: unknown = value
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate) } catch { fail('Plan 不是合法 JSON') }
  }
  const row = record(candidate, 'plan')
  exactKeys(row, [
    'schema', 'version', 'buildNumber', 'productType', 'briefHash', 'controlEpoch',
    'concurrency', 'tasks', 'terminalTaskKey',
  ], 'plan')
  if (row.schema !== 'storyforge.product-production-plan' || row.version !== 3 || !isSha256Hash(row.briefHash)) {
    fail('schema/version/briefHash 无效')
  }
  const productType = enumValue(row.productType, PRODUCTION_PRODUCT_KINDS_V1, 'productType')
  const concurrency = record(row.concurrency, 'concurrency')
  exactKeys(concurrency, [
    'maximumCostBearingTasks', 'maximumTextProviderTasks', 'maximumMediaProviderTasks',
  ], 'concurrency')
  const parsedConcurrency = {
    maximumCostBearingTasks: integer(concurrency.maximumCostBearingTasks, 'concurrency.maximumCostBearingTasks', 3),
    maximumTextProviderTasks: integer(concurrency.maximumTextProviderTasks, 'concurrency.maximumTextProviderTasks', 2),
    maximumMediaProviderTasks: integer(concurrency.maximumMediaProviderTasks, 'concurrency.maximumMediaProviderTasks', 1),
  }
  if (Object.values(parsedConcurrency).some(value => value < 1)) fail('concurrency 必须大于零')
  if (!Array.isArray(row.tasks) || row.tasks.length < 1 || row.tasks.length > 100) fail('tasks 数量无效')
  const tasks = row.tasks.map(parseTask)
  const taskByKey = new Map(tasks.map(task => [task.taskKey, task]))
  if (taskByKey.size !== tasks.length) fail('taskKey 重复')
  const terminalTaskKey = key(row.terminalTaskKey, 'terminalTaskKey')
  if (!taskByKey.has(terminalTaskKey)) fail('terminalTaskKey 不存在')
  const outputOwners = new Map<string, string>()
  for (const task of tasks) {
    if (task.maxAttempts < 1 || task.timeoutMs < 1) fail(`${task.taskKey} attempt/timeout 无效`)
    if (task.dependsOn.some(dep => !taskByKey.has(dep) || dep === task.taskKey)) fail(`${task.taskKey} 依赖无效`)
    const receiptDeps = task.requiredReceipts.map(item => item.taskKey)
    if (receiptDeps.length !== task.dependsOn.length || task.dependsOn.some(dep => !receiptDeps.includes(dep))) {
      fail(`${task.taskKey} requiredReceipts 未闭合 dependsOn`)
    }
    if (task.inputArtifactKeys.some(inputKey => !tasks.some(owner => owner.outputArtifactKeys.includes(inputKey)))) {
      fail(`${task.taskKey} 输入 Artifact 没有 owner`)
    }
    for (const output of task.outputArtifactKeys) {
      if (outputOwners.has(output)) fail(`Artifact ${output} 有多个 owner`)
      outputOwners.set(output, task.taskKey)
    }
    if (task.fallbackTaskKey && (!taskByKey.has(task.fallbackTaskKey) || task.fallbackTaskKey === task.taskKey)) {
      fail(`${task.taskKey} fallback 无效`)
    }
    if (task.failurePolicy === 'fallback' && task.fallbackTaskKey === null) fail(`${task.taskKey} 缺少 fallbackTaskKey`)
    if (task.failurePolicy !== 'fallback' && task.fallbackTaskKey !== null) fail(`${task.taskKey} 非 fallback 任务声明 fallbackTaskKey`)
    if (task.executionMode === 'model' && task.skillId === null) fail(`${task.taskKey} 模型任务缺少 skillId`)
    if (task.executionMode === 'deterministic' && task.skillId !== null) fail(`${task.taskKey} 确定性任务不应绑定 skillId`)
  }
  const visiting = new Set<string>(); const visited = new Set<string>()
  const visit = (taskKey: string) => {
    if (visiting.has(taskKey)) fail(`任务 DAG 有环:${taskKey}`)
    if (visited.has(taskKey)) return
    visiting.add(taskKey)
    for (const dependency of taskByKey.get(taskKey)!.dependsOn) visit(dependency)
    visiting.delete(taskKey); visited.add(taskKey)
  }
  for (const task of tasks) visit(task.taskKey)
  const terminalClosure = new Set<string>()
  const collect = (taskKey: string) => {
    if (terminalClosure.has(taskKey)) return
    terminalClosure.add(taskKey)
    for (const dependency of taskByKey.get(taskKey)!.dependsOn) collect(dependency)
  }
  collect(terminalTaskKey)
  if (terminalClosure.size !== tasks.length) fail('存在未进入 terminal join 的任务')

  const brief = briefInput ? parseProductProductionBriefV3(briefInput) : null
  if (expectedBriefHash != null && (!isSha256Hash(expectedBriefHash) || row.briefHash !== expectedBriefHash)) {
    fail('briefHash 不一致')
  }
  if (brief && brief.intent.productType !== productType) fail('Plan 与 Brief productType 不闭合')
  if (brief && brief.capabilityRequirements.some(requirement => (
    requirement.required && !tasks.some(task => task.capabilityRequirementKeys.includes(requirement.requirementKey))
  ))) fail('必需 capability 未覆盖')
  if (brief) {
    const totals = tasks.reduce((sum, task) => ({
      modelCalls: sum.modelCalls + task.budgetReservation.modelCalls,
      inputTokens: sum.inputTokens + task.budgetReservation.inputTokens,
      outputTokens: sum.outputTokens + task.budgetReservation.outputTokens,
      mediaCalls: sum.mediaCalls + task.budgetReservation.mediaCalls,
      durationMs: sum.durationMs + task.budgetReservation.durationMs,
      storageBytes: sum.storageBytes + task.budgetReservation.storageBytes,
      maximumCostUsd: sum.maximumCostUsd == null || task.budgetReservation.maximumCostUsd == null
        ? null : sum.maximumCostUsd + task.budgetReservation.maximumCostUsd,
    }), {
      modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0,
      durationMs: 0, storageBytes: 0, maximumCostUsd: 0 as number | null,
    })
    const budget = brief.productionBudget
    // Provider completion usage can include hidden reasoning tokens even when
    // visible JSON is tightly bounded. Text-adventure task ceilings may be
    // overbooked by at most 30%; the scheduler's append-only Build ledger is
    // still the hard authority and refuses each call once real usage plus
    // in-flight reservations would exceed the author-approved total.
    const maximumReservedOutputTokens = productType === 'text-adventure'
      ? Math.floor(budget.maximumOutputTokens * 1.3)
      : budget.maximumOutputTokens
    if (totals.modelCalls > budget.maximumModelCalls || totals.inputTokens > budget.maximumInputTokens
      || totals.outputTokens > maximumReservedOutputTokens || totals.mediaCalls > budget.maximumMediaCalls
      || totals.durationMs > budget.maximumDurationMs || totals.storageBytes > budget.maximumStorageBytes
      || (budget.maximumCostUsd != null
        && (totals.maximumCostUsd == null || totals.maximumCostUsd > budget.maximumCostUsd))) {
      fail('Plan 预算预留超过 Brief 授权')
    }
    const canonicalInputBudget = Math.floor(
      Math.min(budget.maximumInputTokens, 180_000) / 5,
    )
    const canonicalInputTasks = [
      'content.design', 'content.narrative', 'content.product-module',
      'media.requirements', 'integration.package',
    ]
    const isCanonicalProductionPlan = productType !== 'text-adventure'
      && (canonicalInputTasks.some(taskKey => taskByKey.has(taskKey)) || taskByKey.has('qa.release'))
    if (isCanonicalProductionPlan && canonicalInputTasks.some(taskKey => (
      taskByKey.get(taskKey)?.budgetReservation.inputTokens !== canonicalInputBudget
    ))) {
      fail('Plan 输入预算切片不是当前生产协议')
    }
  }
  return {
    schema: 'storyforge.product-production-plan', version: 3,
    buildNumber: integer(row.buildNumber, 'buildNumber'), productType,
    briefHash: row.briefHash, controlEpoch: integer(row.controlEpoch, 'controlEpoch'),
    concurrency: parsedConcurrency, tasks, terminalTaskKey,
  }
}

function reservation(input: Partial<ProductTaskBudgetReservationV1>): ProductTaskBudgetReservationV1 {
  return {
    modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0,
    maximumCostUsd: 0, durationMs: 0, storageBytes: 0, ...input,
  }
}

function productionTask(
  value: Omit<ProductProductionPlanTaskV3, 'requiredReceipts' | 'reuse'>,
): ProductProductionPlanTaskV3 {
  return {
    ...value,
    requiredReceipts: value.dependsOn.map(taskKey => ({ taskKey, receiptHash: null })),
    reuse: null,
  }
}

/**
 * Commercial construction skeleton. The topology and reservations are frozen
 * before execution; task executors may refine candidates but cannot add hidden
 * provider calls, dependencies, or output owners.
 */
export async function createProductProductionPlanV3(input: {
  buildNumber: number
  controlEpoch?: number
  briefHash: string
  brief: ProductProductionBriefV3 | string
}): Promise<ProductProductionPlanV3> {
  const brief = parseProductProductionBriefV3(input.brief)
  if (!Number.isInteger(input.buildNumber) || input.buildNumber < 1) fail('buildNumber 无效')
  if (!isSha256Hash(input.briefHash)) fail('briefHash 无效')
  if (await hashProductProductionValueV2(brief) !== input.briefHash) fail('briefHash 与 Brief 内容不一致')
  const controlEpoch = input.controlEpoch ?? 0
  if (!Number.isInteger(controlEpoch) || controlEpoch < 0) fail('controlEpoch 无效')

  const capabilityKeys = (classes: Array<ProductProductionBriefV3['capabilityRequirements'][number]['mediaClass']>) => (
    brief.capabilityRequirements
      .filter(requirement => classes.includes(requirement.mediaClass))
      .map(requirement => requirement.requirementKey)
  )
  const textCapabilities = capabilityKeys(['text'])
  const imageCapabilities = capabilityKeys(['image'])
  const audioCapabilities = capabilityKeys(['music', 'sfx', 'voice'])
  const transcodeCapabilities = capabilityKeys(['transcode'])
  const activeVisual = brief.media.imageCount > 0 || imageCapabilities.length > 0
  const audioCalls = brief.media.musicTrackCount + brief.media.sfxCount + brief.media.voiceLineCount
  const activeAudio = audioCalls > 0 || audioCapabilities.length > 0
  const activeMediaLaneCount = Number(activeVisual) + Number(activeAudio)
  const visualArtifactKeys = Array.from(
    { length: activeVisual ? Math.max(1, brief.media.imageCount) : 0 },
    (_, index) => `media.visual.${String(index + 1).padStart(3, '0')}`,
  )
  const audioArtifactKeys = Array.from(
    { length: activeAudio ? Math.max(1, audioCalls) : 0 },
    (_, index) => `media.audio.${String(index + 1).padStart(3, '0')}`,
  )
  const textAdventure = brief.intent.productType === 'text-adventure'
  const visualReviewBatches = textAdventure && activeVisual
    ? textAdventureVisualReviewArtifactBatchesV1(visualArtifactKeys)
        .map((batchVisualArtifactKeys, index) => {
          const batchNumber = index + 1
          return {
            taskKey: `media.visual-quality-review.batch-${batchNumber}`,
            artifactKey: `quality.visual-review.batch-${batchNumber}`,
            visualArtifactKeys: batchVisualArtifactKeys,
          }
        })
    : []
  // The previous 28-task topology contained three whole-act scene writers.
  // Replace those with the frozen scene packets actually required by this
  // Brief; every packet remains one durable model Run.
  const textAdventureBudgetFloor = textAdventure
    ? textAdventureProductionBudgetFloorV1(brief) : null
  const modelTaskCount = textAdventureBudgetFloor?.modelTaskCount ?? 4
  const textAdventureOutputWeights: Record<string, number> = {
    // Agnes/OpenAI-compatible usage receipts include the Showrunner's hidden
    // reasoning tokens. A real commercial run used 2,522 output tokens while
    // the former 1.5% reservation only allowed 1,500, so the otherwise valid
    // first task was stranded before any downstream work could start. Two
    // percent gives the repaired 160k envelope a 3,200-token ceiling, while
    // the Build-lifetime ledger remains the hard aggregate authority.
    'production.supervision': 0.02,
    // The full WorldRelease sufficiency audit is another reasoning-heavy
    // planning task. Real commercial attempts reported 3,687 and 5,363
    // billed output tokens, so the previous 2%/2,000-token slice was not a
    // truthful ceiling. Four percent gives a repaired 160k Brief a 6,400-token
    // ceiling while returning unused reservation to adjacent bibles.
    'content.source-sufficiency': 0.04,
    'content.design': 0.015,
    // A real commercial Story Bible receipt used 2,835 output tokens. The
    // repaired 160k envelope therefore reserves 4,000 tokens.
    'content.story-bible': 0.025,
    // Cast, space and system bibles have comparable schema depth. Real Cast
    // Bible receipts used up to 5,914 tokens; the three specialists therefore
    // receive 6,400–7,200 token ceilings in the repaired 160k envelope.
    'content.cast-bible': 0.045,
    'content.adventure-architecture': 0.04,
    'content.product-module': 0.04,
    // A live three-act repair returned 9,429 billable output tokens after
    // hidden reasoning, exceeding the former 7,000-token reservation. Keep a
    // bounded 10k ceiling for the complete three-act scene-card topology.
    'content.narrative-arc-scenes': 0.05,
    // Decision planning carries every branch option, persistent echo and
    // cross-scene consequence. A real repair receipt used 6,837 output tokens
    // and exceeded the former 6,120 ceiling, so reserve the same 8k class as
    // other deep structured planning tasks at the 200k baseline.
    'content.narrative-decision-plan': 0.04,
    'content.ending-route-plan': 0.02,
    'content.main-quest-plan': 0.035,
    // One whole act still encouraged providers to collapse multi-route
    // objectives. Each act therefore has a simple and complex Run. Live Agnes
    // receipts include hidden reasoning: a later one-objective single-route
    // packet reported 6,831 tokens and exceeded the former 5,100-token frozen
    // ceiling. Reserve 8k for every bounded main-quest packet. The combined
    // side/ambient supplemental packet later returned 10,009 billed output
    // tokens, so it receives a measured 12k ceiling; the append-only Build
    // ledger remains the aggregate authority and charges actual usage.
    'content.quest-script.main.act-1.single': 0.04,
    'content.quest-script.main.act-1.multi': 0.04,
    'content.quest-script.main.act-2.single': 0.04,
    'content.quest-script.main.act-2.multi': 0.04,
    'content.quest-script.main.act-3.single': 0.04,
    'content.quest-script.main.act-3.multi': 0.04,
    'content.quest-script.supplemental': 0.06,
    // Scene prose is the player-visible product, not scaffolding. Each act is
    // split into two bounded scene packets so a provider cannot strand a whole
    // act in one oversized request. The Scene Writer skill keeps its 24k
    // visible-generation ceiling, but provider receipts also bill hidden
    // reasoning: a live packet reported 29,343 output tokens and exceeded the
    // old 24,128 Plan reservation. Reserve 32k per packet at the reviewed 200k
    // task baseline (24k visible + a bounded 8k reasoning allowance). This is
    // 2,657 tokens of measured headroom, while the append-only Build ledger
    // remains the aggregate hard limit.
    'content.scene-script.act-1.part-1': 0.16,
    'content.scene-script.act-1.part-2': 0.16,
    'content.scene-script.act-2.part-1': 0.16,
    'content.scene-script.act-2.part-2': 0.16,
    'content.scene-script.act-3.part-1': 0.16,
    'content.scene-script.act-3.part-2': 0.16,
    // The provider usage receipt includes hidden reasoning even though the
    // visible response is only an ordinal delta. Two live first-act reviews
    // used 15,205 and 24,077 billed output tokens. Every Dialogue Editor gets
    // a 32k ceiling at the reviewed 200k baseline so normal provider variance
    // remains bounded without discarding another paid result. The append-only
    // Build ledger, not the sum of task ceilings, remains the hard budget.
    'content.dialogue-pass.act-1': 0.16,
    'content.dialogue-pass.act-2': 0.16,
    'content.dialogue-pass.act-3': 0.16,
    // A later three-quest flagship receipt reported 7,457 billable output
    // tokens once provider-hidden reasoning was included. A live four-event
    // ambient repair later reported 7,878 billable output tokens as well, so
    // both bounded supplemental writers receive an 8,000-token ceiling at the
    // reviewed baseline. The append-only Build ledger still charges actual
    // usage and remains the author-approved aggregate hard limit.
    // A location-authority repair for the three multi-stage side quests used
    // 11,131 billable output tokens. Reserve 12k so a contract-valid result is
    // not discarded solely because provider reasoning is included in usage.
    'content.adventure-side-quests': 0.06,
    'content.adventure-ambient-events': 0.04,
    // Each independent continuity review owns one bounded evidence packet.
    // Provider receipts may charge hidden reasoning tokens even though the
    // visible result is a compact scorecard, so every professional Run keeps
    // the previously observed whole-review ceiling. The Build ledger remains
    // the aggregate authority; the public scorecard assembly uses no model.
    // Live act reviews returned 18,550 and then 27,915 billable output tokens
    // once provider reasoning was included, exceeding the former 24,128
    // frozen reservation. Match the reviewed 32k ceiling used by other deep
    // editorial passes; actual usage remains charged by the append-only Build
    // ledger and cannot exceed the author-approved Build lifetime envelope.
    ...Object.fromEntries(TEXT_ADVENTURE_QUALITY_REVIEW_SCOPES_V1.map(scope => [
      textAdventureQualityReviewTaskKeyV1(scope), 0.16,
    ])),
    // Live 12-image flagship manifests reached 5,552 billable output tokens
    // after explicit narrative-beat grounding was added. Reserve 7,000 at the
    // reviewed 200k baseline so hidden reasoning cannot invalidate an otherwise
    // bounded receipt; the Build-lifetime ledger remains the hard ceiling.
    'media.requirements': 0.035,
    // One tiny real image-input request proves the configured text model can
    // observe image bytes before any paid Agnes generation is admitted.
    'media.vision-preflight': 0.002,
    // Each bounded Visual QA Run reviews one frozen image. A live repair
    // review used 2,782 billable output tokens because the provider included
    // detailed issue evidence and recommendations. Reserve 4,000 at the
    // reviewed 200k baseline; the Build-lifetime ledger remains authoritative.
    'media.visual-quality-review': 0.02,
    // The independent playtest director consumes the complete frozen runtime,
    // autoplay evidence and release report. Two live flagship receipts billed
    // 6,404 and 5,066 output tokens once provider-hidden reasoning was
    // included, so the former 3,000-token ceiling repeatedly discarded a
    // contract-valid final artifact after every other quality gate had passed.
    // Reserve 8,000 at the reviewed 200k baseline; actual usage is still
    // charged to the append-only Build ledger and remains author-bounded.
    'qa.playtest-strategy': 0.04,
  }
  // Most model tasks consume a similarly sized context packet. Dialogue and
  // independent whole-product review are exceptions: even after compact
  // ordinal protocols, provider receipts include the system prompt and schema
  // framing in addition to the frozen packet. Give those tasks an explicit
  // ceiling while retaining aggregate input headroom for retries. The
  // append-only Build ledger below the Plan remains the hard authority.
  const textAdventureInputWeights: Record<string, number> = {
    // Media direction reads the complete accepted narrative closure so every
    // illustration is traceable to a real scene beat. The 60-minute golden
    // fixture produces a 57,774-token exact packet; reserve 63,360 tokens at
    // the reviewed 528k baseline instead of truncating story-to-image evidence.
    'media.requirements': 0.12,
    // Scene repair must carry the complete previously accepted prose bundle,
    // not a lossy summary. A live baseline-preserving repair consumed 19,369
    // input tokens after packet, repair evidence, full baseline, system schema
    // and provider framing were accounted together. Reserve 23,760 in the
    // reviewed 528k task baseline (22.7% measured headroom) for both initial
    // and repair attempts; the append-only Build ledger remains the aggregate
    // authority and charges actual usage only.
    'content.scene-script.act-1.part-1': 0.045,
    'content.scene-script.act-1.part-2': 0.045,
    'content.scene-script.act-2.part-1': 0.045,
    'content.scene-script.act-2.part-2': 0.045,
    'content.scene-script.act-3.part-1': 0.045,
    'content.scene-script.act-3.part-2': 0.045,
    // A complete 60-minute third act produced a 17,425-token registered
    // Dialogue Editor packet before the system/schema/provider framing was
    // added. Keep the whole act together for character voice and knowledge
    // continuity, but reserve 26,400 tokens per act so that framing retains
    // about 6.4k of explicit headroom beyond the 20k packet hard limit.
    'content.dialogue-pass.act-1': 0.05,
    'content.dialogue-pass.act-2': 0.05,
    'content.dialogue-pass.act-3': 0.05,
    ...Object.fromEntries(TEXT_ADVENTURE_QUALITY_REVIEW_SCOPES_V1.map(scope => [
      textAdventureQualityReviewTaskKeyV1(scope), 0.075,
    ])),
    // Keep the measured four-image ceiling even though reliability work now
    // sends two provider-native 1K images per batch. The headroom covers image
    // token variance without weakening the Build-lifetime hard budget.
    'media.visual-quality-review': 0.05,
    // Live provider-native image probes consumed 1,141, 2,163 and then 7,387
    // input tokens after image accounting, provider framing and hidden usage
    // were included. Reserve 15,840 at the reviewed 528k baseline so provider
    // variance cannot discard a valid one-shot proof after it has returned.
    // The append-only Build ledger still charges actual usage only.
    'media.vision-preflight': 0.03,
  }
  // Every provider task and deterministic integration receives a declared
  // slice. Text adventure reserves separate bounded specialists for the
  // architecture, mainline, side content, ambient events and systems.
  // Keep explicit Build-level retry headroom. Without it, a single unknown
  // paid call consumes one task ceiling and the remaining first attempts can
  // no longer be admitted even though every task declares bounded recovery.
  const retryReserveSlots = textAdventureBudgetFloor?.retryReserveSlots ?? 0
  const perInput = Math.floor(
    (textAdventure
      ? brief.productionBudget.maximumInputTokens / (modelTaskCount + retryReserveSlots)
      : Math.min(brief.productionBudget.maximumInputTokens, 180_000) / 5),
  )
  const perOutput = Math.floor(
    (textAdventure
      ? brief.productionBudget.maximumOutputTokens / (modelTaskCount + retryReserveSlots)
      : Math.min(brief.productionBudget.maximumOutputTokens, 60_000) / 4),
  )
  const activeMediaTaskCount = textAdventure
    ? visualArtifactKeys.length + audioArtifactKeys.length
    : activeMediaLaneCount
  const textAdventureDeterministicTaskCount = textAdventure ? 13 + Number(activeVisual) * 2 : 4
  const durationSlots = modelTaskCount + textAdventureDeterministicTaskCount + activeMediaTaskCount
  const perDuration = Math.floor(
    (textAdventure
      ? brief.productionBudget.maximumDurationMs / Math.max(1, durationSlots + retryReserveSlots)
      : Math.min(brief.productionBudget.maximumDurationMs, 3_600_000) / 8),
  )
  const costTaskCount = modelTaskCount + activeMediaTaskCount
  const perCost = brief.productionBudget.maximumCostUsd == null
    ? null
    : brief.productionBudget.maximumCostUsd / Math.max(1, costTaskCount + retryReserveSlots)
  const mediaStorage = activeMediaTaskCount === 0
    ? 0
    : Math.floor(brief.productionBudget.maximumStorageBytes / activeMediaTaskCount)

  // Increasing the Build lifetime envelope must create retry/aggregate
  // headroom, not silently make every individual provider request larger.
  // These baselines preserve the reviewed task ceilings of the 200k/528k
  // flagship plan while the append-only ledger may admit the remaining Runs.
  const textAdventureTaskOutputBaseline = Math.min(
    brief.productionBudget.maximumOutputTokens,
    200_000,
  )
  const textAdventureTaskInputBaseline = Math.min(
    brief.productionBudget.maximumInputTokens,
    528_000,
  )
  const modelBudget = (taskKey: string) => reservation({
    modelCalls: 1,
    inputTokens: textAdventure && textAdventureInputWeights[taskKey] != null
      ? Math.floor(textAdventureTaskInputBaseline * textAdventureInputWeights[taskKey])
      : perInput,
    outputTokens: textAdventure
      ? taskKey === 'media.requirements'
        ? Math.min(
            brief.productionBudget.maximumOutputTokens,
            Math.max(5_000, Math.floor(textAdventureTaskOutputBaseline * textAdventureOutputWeights[taskKey])),
          )
        : Math.floor(textAdventureTaskOutputBaseline * textAdventureOutputWeights[taskKey])
      : perOutput,
    maximumCostUsd: perCost,
    // Provider latency is part of the task receipt, not merely a scheduler
    // timeout. Reserve observed long-form ceilings so a successful paid
    // response is not rejected against the generic average after it returns.
    // The complete Plan still stays inside the author-approved Build duration
    // envelope and the append-only ledger charges actual time.
    durationMs: textAdventure && /^content\.scene-script\.act-[1-3]\.part-[1-2]$/.test(taskKey)
      // A live commercial scene packet reached the former 300-second bound
      // before the provider could return its long structured prose. Give only
      // scene-writer Runs a measured seven-minute envelope; all calls remain
      // abortable, metered and bounded by the Build lifetime ledger.
      ? 420_000
      : textAdventure && (
        /^content\.quest-script\.main\.act-[1-3]\.(?:single|multi)$/.test(taskKey)
        || taskKey === 'content.main-quest-plan'
      )
        // Live repair production reached the former five-minute contract in
        // both the main-quest planner and a main-route script compiler. These
        // Runs own full-act objective/alternative closure, so align their
        // receipt reservation with a bounded seven-minute hard timeout.
        ? 420_000
      : textAdventure && (
        taskKey === 'content.quest-script.supplemental'
        || /^content\.dialogue-pass\.act-[1-3]$/.test(taskKey)
        || taskKey === 'content.source-sufficiency'
      ) ? 300_000
      : textAdventure && (
        taskKey === 'content.adventure-side-quests'
        || taskKey === 'content.adventure-ambient-events'
      )
        // A real directed-repair side-quest Run returned a valid candidate at
        // 207.3s. Match the already-frozen four-minute task timeout so a paid,
        // schema-valid response is not rejected against the generic 180s
        // receipt reservation after it has completed.
        ? 240_000
      : textAdventure && taskKey === 'media.requirements'
        ? 180_000
      : textAdventure && /^content\.adventure-quality-review\.(structure|act-[1-3])$/.test(taskKey)
        // Commercial review batches inspect the complete frozen narrative
        // closure. A real provider receipt reached 185.8s, so the former
        // generic 180s reservation could reject a successful paid response.
        // A later cross-epoch repair review reached the full 240s contract.
        // Six minutes gives the read-only reviewer enough time to traverse
        // all frozen evidence while retaining a hard abortable bound.
        ? 360_000
      : textAdventure && taskKey === 'media.visual-quality-review'
        ? 270_000
      : textAdventure
        ? 180_000
        : perDuration,
  })
  const tasks: ProductProductionPlanTaskV3[] = []
  if (textAdventure) tasks.push(productionTask({
    taskKey: 'production.supervision', lane: 'planning', kind: 'text-adventure-production-supervision',
    skillId: 'text-adventure.production-supervision.v1', executionMode: 'model', dependsOn: [],
    inputArtifactKeys: [], outputArtifactKeys: ['production.supervision'], requirementKeys: [],
    capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
    subjectLockKeys: ['production.supervision'], priority: 120,
    budgetReservation: modelBudget('production.supervision'),
    maxAttempts: 2, timeoutMs: 180_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['artifact.protocol', 'adventure.production-supervision'],
  }))
  if (textAdventure) tasks.push(productionTask({
    taskKey: 'content.source-sufficiency', lane: 'planning', kind: 'text-adventure-source-sufficiency',
    skillId: 'text-adventure.source-sufficiency.v1', executionMode: 'model', dependsOn: ['production.supervision'],
    inputArtifactKeys: ['production.supervision'], outputArtifactKeys: ['content.source-sufficiency'], requirementKeys: [],
    capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
    subjectLockKeys: ['content.source-sufficiency'], priority: 110, budgetReservation: modelBudget('content.source-sufficiency'),
    // Full WorldRelease analysis is the only planning task that routinely
    // needs more than three minutes on reasoning-capable providers. Keep the
    // retry count bounded, but allow one five-minute attempt to finish instead
    // of aborting a paid response immediately before it returns.
    maxAttempts: 2, timeoutMs: 300_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['artifact.protocol', 'adventure.source-sufficiency-assessed'],
  }))
  if (textAdventure) tasks.push(productionTask({
    taskKey: 'source.author-gate', lane: 'planning', kind: 'text-adventure-source-decision',
    skillId: null, executionMode: 'deterministic', dependsOn: ['content.source-sufficiency'],
    inputArtifactKeys: ['content.source-sufficiency'], outputArtifactKeys: ['content.source-decision'],
    requirementKeys: [], capabilityRequirementKeys: [], concurrencyGroup: 'deterministic',
    subjectLockKeys: ['content.source-decision'], priority: 105,
    budgetReservation: reservation({ durationMs: perDuration }),
    maxAttempts: 1, timeoutMs: 30_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['artifact.protocol', 'adventure.source-decision-authorized'],
  }))
  tasks.push(productionTask({
    taskKey: 'content.design', lane: 'content', kind: 'product-design',
    skillId: textAdventure ? 'text-adventure.creative-direction.v1' : 'product-production.content.v1',
    executionMode: 'model', dependsOn: textAdventure ? ['source.author-gate', 'production.supervision'] : [],
    inputArtifactKeys: textAdventure
      ? ['production.supervision', 'content.source-sufficiency', 'content.source-decision'] : [],
    outputArtifactKeys: ['design.game'], requirementKeys: [],
    capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
    subjectLockKeys: ['design.game'], priority: 100, budgetReservation: modelBudget('content.design'),
    maxAttempts: 2, timeoutMs: 180_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['artifact.protocol', 'design.source-anchors'],
  }))
  if (textAdventure) tasks.push(
    productionTask({
      taskKey: 'content.story-bible', lane: 'planning', kind: 'text-adventure-story-bible',
      skillId: 'text-adventure.story-bible.v1', executionMode: 'model',
      dependsOn: ['source.author-gate', 'content.design'],
      inputArtifactKeys: ['content.source-sufficiency', 'content.source-decision', 'design.game'],
      outputArtifactKeys: ['content.story-bible'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.story-bible'], priority: 98, budgetReservation: modelBudget('content.story-bible'),
      maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.story-bible'],
    }),
    productionTask({
      taskKey: 'content.cast-bible', lane: 'planning', kind: 'text-adventure-cast-bible',
      skillId: 'text-adventure.cast-bible.v1', executionMode: 'model',
      dependsOn: ['content.source-sufficiency', 'content.story-bible'],
      inputArtifactKeys: ['content.source-sufficiency', 'content.story-bible'],
      outputArtifactKeys: ['content.cast-bible'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.cast-bible'], priority: 97, budgetReservation: modelBudget('content.cast-bible'),
      maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.cast-bible'],
    }),
    productionTask({
      taskKey: 'content.adventure-architecture', lane: 'planning', kind: 'text-adventure-architecture',
      skillId: 'text-adventure.production-architecture.v1', executionMode: 'model',
      dependsOn: ['content.story-bible', 'content.cast-bible'],
      inputArtifactKeys: ['content.story-bible', 'content.cast-bible'],
      outputArtifactKeys: ['content.adventure-architecture'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.adventure-architecture'], priority: 95, budgetReservation: modelBudget('content.adventure-architecture'),
      maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.architecture'],
    }),
    productionTask({
      taskKey: 'content.product-module', lane: 'content', kind: 'product-module',
      skillId: 'text-adventure.production-systems.v1', executionMode: 'model',
      dependsOn: ['content.story-bible', 'content.cast-bible', 'content.adventure-architecture'],
      inputArtifactKeys: ['content.story-bible', 'content.cast-bible', 'content.adventure-architecture'],
      outputArtifactKeys: ['content.product-module'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.product-module'], priority: 92, budgetReservation: modelBudget('content.product-module'),
      maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'product.module'],
    }),
    productionTask({
      taskKey: 'content.narrative-arc-scenes', lane: 'planning', kind: 'text-adventure-narrative-arc-scenes',
      skillId: 'text-adventure.narrative-design.v1', executionMode: 'model',
      dependsOn: ['content.story-bible', 'content.cast-bible', 'content.adventure-architecture', 'content.product-module'],
      inputArtifactKeys: ['content.story-bible', 'content.cast-bible', 'content.adventure-architecture', 'content.product-module'],
      outputArtifactKeys: ['content.narrative-arc-scenes'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.narrative-arc-scenes'], priority: 90, budgetReservation: modelBudget('content.narrative-arc-scenes'),
      maxAttempts: 2, timeoutMs: 300_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.narrative-arc-scenes'],
    }),
    productionTask({
      taskKey: 'content.narrative-decision-plan', lane: 'planning', kind: 'text-adventure-narrative-decision-plan',
      skillId: 'text-adventure.narrative-design.v1', executionMode: 'model',
      dependsOn: ['content.story-bible', 'content.cast-bible', 'content.narrative-arc-scenes'],
      inputArtifactKeys: ['content.story-bible', 'content.cast-bible', 'content.narrative-arc-scenes'],
      outputArtifactKeys: ['content.narrative-decision-plan'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.narrative-decision-plan'], priority: 89, budgetReservation: modelBudget('content.narrative-decision-plan'),
      maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.narrative-decision-plan'],
    }),
    productionTask({
      taskKey: 'content.narrative-arc-plan', lane: 'planning', kind: 'text-adventure-narrative-arc-plan',
      skillId: null, executionMode: 'deterministic',
      dependsOn: [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.narrative-arc-scenes', 'content.narrative-decision-plan',
      ],
      inputArtifactKeys: [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.narrative-arc-scenes', 'content.narrative-decision-plan',
      ],
      outputArtifactKeys: ['content.narrative-arc-plan'], requirementKeys: [],
      capabilityRequirementKeys: [], concurrencyGroup: 'cpu',
      subjectLockKeys: ['content.narrative-arc-plan'], priority: 88,
      budgetReservation: reservation({ durationMs: perDuration }),
      maxAttempts: 1, timeoutMs: 30_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.narrative-arc-plan'],
    }),
    productionTask({
      taskKey: 'content.ending-route-plan', lane: 'planning', kind: 'text-adventure-ending-route-plan',
      skillId: 'text-adventure.ending-route-plan.v1', executionMode: 'model',
      dependsOn: [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.narrative-arc-plan',
      ],
      inputArtifactKeys: [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.narrative-arc-plan',
      ],
      outputArtifactKeys: ['content.ending-route-plan'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.ending-route-plan'], priority: 87,
      budgetReservation: modelBudget('content.ending-route-plan'),
      maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.ending-route-plan'],
    }),
    productionTask({
      taskKey: 'content.main-quest-plan', lane: 'planning', kind: 'text-adventure-main-quest-plan',
      skillId: 'text-adventure.production-mainline.v1', executionMode: 'model',
      dependsOn: [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.product-module', 'content.narrative-arc-plan',
      ],
      inputArtifactKeys: [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.product-module', 'content.narrative-arc-plan',
      ],
      outputArtifactKeys: ['content.main-quest-plan'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.main-quest-plan'], priority: 87, budgetReservation: modelBudget('content.main-quest-plan'),
      maxAttempts: 2, timeoutMs: 420_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.main-quest-plan'],
    }),
  )
  if (!textAdventure) tasks.push(
    productionTask({
      taskKey: 'content.narrative', lane: 'content', kind: 'narrative',
      skillId: 'product-production.content.v1', executionMode: 'model', dependsOn: ['content.design'],
      inputArtifactKeys: ['design.game'], outputArtifactKeys: ['content.narrative'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.narrative'], priority: 90, budgetReservation: modelBudget('content.narrative'),
      maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'narrative.graph'],
    }),
    productionTask({
      taskKey: 'content.product-module', lane: 'content', kind: 'product-module',
      skillId: 'product-production.content.v1', executionMode: 'model', dependsOn: brief.intent.productType === 'ttrpg' ? ['content.design', 'content.narrative'] : ['content.design'],
      inputArtifactKeys: brief.intent.productType === 'ttrpg' ? ['design.game', 'content.narrative'] : ['design.game'], outputArtifactKeys: ['content.product-module'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.product-module'], priority: 85, budgetReservation: modelBudget('content.product-module'),
      maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'product.module'],
    }),
  )
  if (textAdventure) tasks.push(
    productionTask({
      taskKey: 'content.adventure-side-quests', lane: 'content', kind: 'text-adventure-side-quests',
      skillId: 'text-adventure.production-side-quests.v1', executionMode: 'model',
      dependsOn: ['content.adventure-architecture', 'content.product-module', 'content.main-quest-plan'],
      inputArtifactKeys: ['content.adventure-architecture', 'content.product-module', 'content.main-quest-plan'],
      outputArtifactKeys: ['content.adventure-side-quests'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.adventure-side-quests'], priority: 82, budgetReservation: modelBudget('content.adventure-side-quests'),
      maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.side-quests'],
    }),
    productionTask({
      taskKey: 'content.adventure-ambient-events', lane: 'content', kind: 'text-adventure-ambient-events',
      skillId: 'text-adventure.production-ambient-events.v1', executionMode: 'model',
      dependsOn: ['content.adventure-architecture', 'content.product-module', 'content.main-quest-plan'],
      inputArtifactKeys: ['content.adventure-architecture', 'content.product-module', 'content.main-quest-plan'],
      outputArtifactKeys: ['content.adventure-ambient-events'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.adventure-ambient-events'], priority: 80, budgetReservation: modelBudget('content.adventure-ambient-events'),
      maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.ambient-events'],
    }),
  )
  if (textAdventure) {
    const mainQuestScriptInputs = [
      'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
      'content.product-module', 'content.narrative-arc-plan', 'content.main-quest-plan',
    ]
    for (let act = 1; act <= 3; act += 1) {
      for (const routeClass of ['single', 'multi'] as const) {
        const taskKey = `content.quest-script.main.act-${act}.${routeClass}`
        tasks.push(productionTask({
          taskKey, lane: 'content', kind: 'text-adventure-quest-script-part',
          skillId: 'text-adventure.quest-script.v1', executionMode: 'model',
          dependsOn: mainQuestScriptInputs,
          inputArtifactKeys: mainQuestScriptInputs,
          outputArtifactKeys: [taskKey], requirementKeys: [],
          capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
          subjectLockKeys: [taskKey], priority: 82 - act * 2 - Number(routeClass === 'multi'),
          budgetReservation: modelBudget(taskKey),
          maxAttempts: 2, timeoutMs: 420_000, failurePolicy: 'pause', fallbackTaskKey: null,
          acceptanceGateIds: ['artifact.protocol', 'adventure.quest-script-part'],
        }))
      }
    }
    tasks.push(productionTask({
      taskKey: 'content.quest-script.supplemental', lane: 'content',
      kind: 'text-adventure-quest-script-part',
      skillId: 'text-adventure.quest-script.v1', executionMode: 'model',
      dependsOn: [
        'content.product-module', 'content.adventure-side-quests', 'content.adventure-ambient-events',
      ],
      inputArtifactKeys: [
        'content.product-module', 'content.adventure-side-quests', 'content.adventure-ambient-events',
      ],
      outputArtifactKeys: ['content.quest-script.supplemental'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.quest-script.supplemental'], priority: 75,
      budgetReservation: modelBudget('content.quest-script.supplemental'),
      maxAttempts: 2, timeoutMs: 300_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.quest-script-part'],
    }))
    const questScriptPartKeys = [1, 2, 3].flatMap(act => [
      `content.quest-script.main.act-${act}.single`,
      `content.quest-script.main.act-${act}.multi`,
    ]).concat('content.quest-script.supplemental')
    tasks.push(productionTask({
      taskKey: 'content.quest-script', lane: 'content', kind: 'text-adventure-quest-script',
      skillId: null, executionMode: 'deterministic', dependsOn: questScriptPartKeys,
      inputArtifactKeys: [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.product-module', 'content.narrative-arc-plan', 'content.main-quest-plan',
        'content.adventure-side-quests', 'content.adventure-ambient-events', ...questScriptPartKeys,
      ],
      outputArtifactKeys: ['content.quest-script'], requirementKeys: [], capabilityRequirementKeys: [],
      concurrencyGroup: 'deterministic', subjectLockKeys: ['content.quest-script'], priority: 74,
      budgetReservation: reservation({ durationMs: perDuration }), maxAttempts: 1,
      timeoutMs: 30_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.quest-script'],
    }))
  }
  if (textAdventure) {
    const sceneScriptDependencies = [
      'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
      'content.product-module', 'content.narrative-arc-plan',
      'content.ending-route-plan',
      'content.main-quest-plan', 'content.adventure-side-quests', 'content.adventure-ambient-events',
      'content.quest-script',
    ]
    for (let act = 1; act <= 3; act += 1) {
      const partKeys = textAdventureSceneScriptPartSceneKeysV1(brief, act - 1).map((_, partIndex) => (
        `content.scene-script.act-${act}.part-${partIndex + 1}`
      ))
      for (const taskKey of partKeys) tasks.push(productionTask({
        taskKey, lane: 'content', kind: 'text-adventure-scene-script-part',
        skillId: 'text-adventure.scene-script.v1', executionMode: 'model',
        dependsOn: sceneScriptDependencies,
        inputArtifactKeys: sceneScriptDependencies,
        outputArtifactKeys: [taskKey], requirementKeys: [],
        capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
        subjectLockKeys: [taskKey], priority: 79 - act, budgetReservation: modelBudget(taskKey),
        maxAttempts: 2, timeoutMs: 420_000, failurePolicy: 'pause', fallbackTaskKey: null,
        acceptanceGateIds: ['artifact.protocol', 'adventure.scene-script-part'],
      }))
      const taskKey = `content.scene-script.act-${act}`
      tasks.push(productionTask({
        taskKey, lane: 'content', kind: 'text-adventure-scene-script-bundle',
        skillId: null, executionMode: 'deterministic', dependsOn: partKeys,
        inputArtifactKeys: [
          'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
          'content.narrative-arc-plan', ...partKeys,
        ],
        outputArtifactKeys: [taskKey], requirementKeys: [], capabilityRequirementKeys: [],
        concurrencyGroup: 'deterministic', subjectLockKeys: [taskKey], priority: 75 - act,
        budgetReservation: reservation({ durationMs: perDuration }), maxAttempts: 1,
        timeoutMs: 30_000, failurePolicy: 'pause', fallbackTaskKey: null,
        acceptanceGateIds: ['artifact.protocol', 'adventure.scene-script-bundle'],
      }))
    }
    const sceneScriptTaskKeys = [
      'content.scene-script.act-1', 'content.scene-script.act-2', 'content.scene-script.act-3',
    ]
    const dialoguePassTaskKeys: string[] = []
    for (let act = 1; act <= 3; act += 1) {
      const sceneTaskKey = `content.scene-script.act-${act}`
      const taskKey = `content.dialogue-pass.act-${act}`
      dialoguePassTaskKeys.push(taskKey)
      tasks.push(productionTask({
        taskKey, lane: 'content', kind: 'text-adventure-dialogue-pass',
        skillId: 'text-adventure.dialogue-pass.v1', executionMode: 'model',
        dependsOn: [
          'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
          'content.narrative-arc-plan', sceneTaskKey,
        ],
        inputArtifactKeys: [
          'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
          'content.narrative-arc-plan', sceneTaskKey,
        ],
        outputArtifactKeys: [taskKey], requirementKeys: [],
        capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
        subjectLockKeys: [taskKey], priority: 73 - act,
        budgetReservation: modelBudget(taskKey),
        maxAttempts: 2, timeoutMs: 300_000, failurePolicy: 'pause', fallbackTaskKey: null,
        acceptanceGateIds: ['artifact.protocol', 'adventure.dialogue-pass'],
      }))
    }
    tasks.push(productionTask({
      taskKey: 'integration.narrative', lane: 'integration', kind: 'narrative-assembly',
      skillId: null, executionMode: 'deterministic',
      dependsOn: [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.narrative-arc-plan',
        'content.ending-route-plan',
        ...sceneScriptTaskKeys, ...dialoguePassTaskKeys,
      ],
      inputArtifactKeys: [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.narrative-arc-plan',
        'content.ending-route-plan',
        ...sceneScriptTaskKeys, ...dialoguePassTaskKeys,
      ],
      outputArtifactKeys: ['content.narrative'], requirementKeys: [],
      capabilityRequirementKeys: [], concurrencyGroup: 'deterministic',
      subjectLockKeys: ['content.narrative'], priority: 73,
      budgetReservation: reservation({ durationMs: perDuration }),
      maxAttempts: 1, timeoutMs: 120_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'narrative.graph'],
    }))
  }
  const textAdventureQualitySourceTaskKeys = [
    'production.supervision',
    'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
    'content.product-module', 'content.narrative-arc-plan', 'content.main-quest-plan',
    'content.ending-route-plan',
    'content.adventure-side-quests', 'content.adventure-ambient-events', 'content.quest-script',
    'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2',
    'content.dialogue-pass.act-3', 'integration.narrative',
  ]
  const textAdventureQualitySourceArtifactKeys = [
    'production.supervision',
    'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
    'content.product-module', 'content.narrative-arc-plan', 'content.main-quest-plan',
    'content.ending-route-plan',
    'content.adventure-side-quests', 'content.adventure-ambient-events', 'content.quest-script',
    'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2',
    'content.dialogue-pass.act-3', 'content.narrative',
  ]
  const textAdventureQualityBatchTaskKeys = textAdventureQualityReviewBatchTaskKeysV1()
  if (textAdventure) {
    TEXT_ADVENTURE_QUALITY_REVIEW_SCOPES_V1.forEach((scope, index) => {
      const taskKey = textAdventureQualityReviewTaskKeyV1(scope)
      const artifactKey = textAdventureQualityReviewBatchArtifactKeyV1(scope)
      tasks.push(productionTask({
        taskKey, lane: 'qa', kind: 'text-adventure-quality-review-batch',
        skillId: 'text-adventure.production-quality-review.v1', executionMode: 'model',
        dependsOn: textAdventureQualitySourceTaskKeys,
        inputArtifactKeys: textAdventureQualitySourceArtifactKeys,
        outputArtifactKeys: [artifactKey], requirementKeys: [],
        capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
        subjectLockKeys: [artifactKey], priority: 78 - index,
        budgetReservation: modelBudget(taskKey),
        maxAttempts: 2, timeoutMs: 360_000, failurePolicy: 'pause', fallbackTaskKey: null,
        acceptanceGateIds: ['artifact.protocol', 'adventure.narrative-quality-review-batch'],
      }))
    })
    tasks.push(productionTask({
      taskKey: 'content.adventure-quality-review', lane: 'qa',
      kind: 'text-adventure-quality-review-assembly', skillId: null,
      executionMode: 'deterministic', dependsOn: textAdventureQualityBatchTaskKeys,
      inputArtifactKeys: [
        ...textAdventureQualitySourceArtifactKeys,
        ...TEXT_ADVENTURE_QUALITY_REVIEW_SCOPES_V1.map(textAdventureQualityReviewBatchArtifactKeyV1),
      ],
      outputArtifactKeys: ['quality.adventure-review'], requirementKeys: [],
      capabilityRequirementKeys: [], concurrencyGroup: 'deterministic',
      subjectLockKeys: ['quality.adventure-review'], priority: 74,
      budgetReservation: reservation({ durationMs: perDuration }),
      maxAttempts: 1, timeoutMs: 120_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.narrative-quality-review'],
    }))
  }
  const mediaDependenciesForContent = textAdventure
    ? ['content.adventure-quality-review']
    : ['content.design']
  const mediaInputsForContent = textAdventure
    ? [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.product-module', 'content.narrative-arc-plan', 'content.main-quest-plan',
        'content.adventure-side-quests', 'content.adventure-ambient-events', 'content.quest-script',
        'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2',
        'content.dialogue-pass.act-3', 'content.narrative', 'quality.adventure-review',
      ]
    : ['design.game']
  tasks.push(
    productionTask({
      taskKey: 'media.requirements', lane: 'planning', kind: 'media-requirements',
      skillId: textAdventure ? 'text-adventure.visual-direction.v1' : 'product-production.media-requirements.v1',
      executionMode: 'model', dependsOn: mediaDependenciesForContent,
      inputArtifactKeys: mediaInputsForContent, outputArtifactKeys: ['media.requirements'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['media.requirements'], priority: 88, budgetReservation: modelBudget('media.requirements'),
      maxAttempts: 2, timeoutMs: 180_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'media.requirements.coverage'],
    }),
  )
  if (textAdventure) tasks.push(productionTask({
    taskKey: 'media.visual-bible.compile', lane: 'planning', kind: 'text-adventure-visual-bible',
    skillId: null, executionMode: 'deterministic', dependsOn: ['media.requirements'],
    inputArtifactKeys: ['content.cast-bible', 'content.adventure-architecture', 'media.requirements'],
    outputArtifactKeys: ['media.visual-bible'], requirementKeys: [], capabilityRequirementKeys: [],
    concurrencyGroup: 'deterministic', subjectLockKeys: ['media.visual-bible'], priority: 75,
    budgetReservation: reservation({ durationMs: perDuration }), maxAttempts: 1,
    timeoutMs: 30_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['artifact.protocol', 'media.visual-bible'],
  }))
  if (textAdventure && activeVisual) tasks.push(productionTask({
    taskKey: 'media.vision-preflight', lane: 'planning', kind: 'text-adventure-vision-capability-preflight',
    skillId: 'text-adventure.visual-quality-review.v1', executionMode: 'model',
    dependsOn: ['media.visual-bible.compile'], inputArtifactKeys: ['media.visual-bible'],
    outputArtifactKeys: ['media.vision-preflight'], requirementKeys: [],
    capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
    subjectLockKeys: ['media.vision-preflight'], priority: 75,
    budgetReservation: modelBudget('media.vision-preflight'), maxAttempts: 1,
    timeoutMs: 60_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['artifact.protocol', 'media.vision-input-capability'],
  }))
  if (textAdventure && activeVisual) tasks.push(productionTask({
    taskKey: 'media.anchor-author-gate', lane: 'planning', kind: 'text-adventure-media-anchor-decision',
    skillId: null, executionMode: 'deterministic', dependsOn: ['media.vision-preflight'],
    inputArtifactKeys: ['content.cast-bible', 'media.visual-bible', 'media.vision-preflight'],
    outputArtifactKeys: ['media.anchor-decision'], requirementKeys: [], capabilityRequirementKeys: textCapabilities,
    concurrencyGroup: 'deterministic', subjectLockKeys: ['media.anchor-decision'], priority: 74,
    budgetReservation: reservation({ durationMs: perDuration }), maxAttempts: 1,
    timeoutMs: 30_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['artifact.protocol', 'media.character-anchors-authorized'],
  }))
  const mediaDependencies: string[] = []
  if (activeVisual) {
    const taskKeys = textAdventure ? visualArtifactKeys : ['media.visual']
    mediaDependencies.push(...taskKeys)
    for (const taskKey of taskKeys) tasks.push(productionTask({
      taskKey, lane: 'visual', kind: textAdventure ? 'image-asset' : 'image-bundle',
      skillId: 'product-production.media-request.v1', executionMode: 'media-provider',
      dependsOn: textAdventure ? ['media.anchor-author-gate'] : ['media.requirements'],
      inputArtifactKeys: textAdventure
        ? ['media.requirements', 'content.cast-bible', 'media.visual-bible', 'media.anchor-decision']
        : ['media.requirements'],
      outputArtifactKeys: textAdventure ? [taskKey] : visualArtifactKeys,
      requirementKeys: brief.media.requiredMediaKinds.filter(kind => !['bgm', 'sfx', 'voice'].includes(kind)),
      capabilityRequirementKeys: imageCapabilities, concurrencyGroup: 'media-provider',
      subjectLockKeys: textAdventure ? [taskKey] : visualArtifactKeys, priority: 70,
      budgetReservation: reservation({
        mediaCalls: textAdventure ? 1 : brief.media.imageCount, maximumCostUsd: perCost,
        durationMs: perDuration, storageBytes: mediaStorage,
      }),
      maxAttempts: 2, timeoutMs: 600_000,
      failurePolicy: brief.fallbackPolicy.allowTextOnly ? 'skip-optional' : 'pause',
      fallbackTaskKey: null, acceptanceGateIds: ['media.integrity', 'media.rights'],
    }))
  }
  if (activeAudio) {
    const taskKeys = textAdventure ? audioArtifactKeys : ['media.audio']
    mediaDependencies.push(...taskKeys)
    for (const taskKey of taskKeys) tasks.push(productionTask({
      taskKey, lane: 'audio', kind: textAdventure ? 'audio-asset' : 'audio-bundle',
      skillId: 'product-production.media-request.v1', executionMode: 'media-provider',
      dependsOn: ['media.requirements'], inputArtifactKeys: ['media.requirements'],
      outputArtifactKeys: textAdventure ? [taskKey] : audioArtifactKeys,
      requirementKeys: brief.media.requiredMediaKinds.filter(kind => ['bgm', 'sfx', 'voice'].includes(kind)),
      capabilityRequirementKeys: audioCapabilities, concurrencyGroup: 'media-provider',
      subjectLockKeys: textAdventure ? [taskKey] : audioArtifactKeys, priority: 65,
      budgetReservation: reservation({
        mediaCalls: textAdventure ? 1 : audioCalls, maximumCostUsd: perCost,
        durationMs: perDuration, storageBytes: mediaStorage,
      }),
      maxAttempts: 2, timeoutMs: 600_000,
      failurePolicy: brief.fallbackPolicy.allowTextOnly ? 'skip-optional' : 'pause',
      fallbackTaskKey: null, acceptanceGateIds: ['media.integrity', 'media.rights'],
    }))
  }
  if (textAdventure && activeVisual) tasks.push(productionTask({
    taskKey: 'media.audit', lane: 'qa', kind: 'text-adventure-media-audit',
    skillId: null, executionMode: 'deterministic', dependsOn: [...visualArtifactKeys],
    inputArtifactKeys: ['media.requirements', 'content.cast-bible', 'media.visual-bible', ...visualArtifactKeys],
    outputArtifactKeys: ['media.audit'], requirementKeys: [], capabilityRequirementKeys: [],
    concurrencyGroup: 'deterministic', subjectLockKeys: ['media.audit'], priority: 60,
    budgetReservation: reservation({ durationMs: perDuration }), maxAttempts: 1,
    timeoutMs: 60_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['artifact.protocol', 'media.requirement-artifact-audit'],
  }))
  if (textAdventure && activeVisual) {
    for (const batch of visualReviewBatches) tasks.push(productionTask({
      taskKey: batch.taskKey, lane: 'qa', kind: 'text-adventure-visual-quality-review-batch',
      skillId: 'text-adventure.visual-quality-review.v1', executionMode: 'model', dependsOn: ['media.audit'],
      inputArtifactKeys: [
        'content.cast-bible', 'media.requirements', 'media.visual-bible', 'media.audit',
        ...batch.visualArtifactKeys,
      ],
      outputArtifactKeys: [batch.artifactKey], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities,
      // Browser-direct OpenAI-compatible relays may reject concurrent
      // multimodal uploads even when ordinary text concurrency is two. Keep
      // independent batch receipts/retries, but serialize this one provider
      // resource so one failed connection cannot poison its sibling request.
      concurrencyGroup: 'text-provider',
      subjectLockKeys: ['quality.visual-review-provider'], priority: 56,
      budgetReservation: modelBudget('media.visual-quality-review'), maxAttempts: 2,
      timeoutMs: 270_000,
      failurePolicy: brief.qualityProfile === 'commercial-candidate' ? 'pause' : 'skip-optional',
      fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'media.visual-semantic-review-batch-executed'],
    }))
    tasks.push(productionTask({
      taskKey: 'media.visual-quality-review', lane: 'qa', kind: 'text-adventure-visual-quality-review-assembly',
      skillId: null, executionMode: 'deterministic',
      dependsOn: visualReviewBatches.map(batch => batch.taskKey),
      inputArtifactKeys: ['media.audit', ...visualReviewBatches.map(batch => batch.artifactKey)],
      outputArtifactKeys: ['quality.visual-review'], requirementKeys: [], capabilityRequirementKeys: [],
      concurrencyGroup: 'deterministic', subjectLockKeys: ['quality.visual-review'], priority: 55,
      budgetReservation: reservation({ durationMs: perDuration }), maxAttempts: 1,
      timeoutMs: 30_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'media.visual-semantic-review-executed'],
    }))
  }
  const textAdventureDependencies = textAdventure
    ? [
        'production.supervision',
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.narrative-arc-plan', 'content.main-quest-plan', 'content.adventure-side-quests',
        'content.ending-route-plan',
        'content.adventure-ambient-events', 'content.quest-script',
        'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2', 'content.dialogue-pass.act-3',
        'content.adventure-quality-review',
      ] : []
  const integrationDependencies = [
    textAdventure ? 'integration.narrative' : 'content.narrative', 'content.product-module', ...textAdventureDependencies,
    'media.requirements', ...(textAdventure ? ['media.visual-bible.compile'] : []),
    ...(textAdventure && activeVisual ? ['media.anchor-author-gate'] : []), ...mediaDependencies,
    ...(textAdventure && activeVisual ? ['media.audit'] : []),
    ...(textAdventure && activeVisual ? ['media.visual-quality-review'] : []),
  ]
  const textAdventureIntegrationArtifactKeys = textAdventure
    ? [
        'production.supervision',
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.narrative-arc-plan', 'content.main-quest-plan', 'content.adventure-side-quests',
        'content.ending-route-plan',
        'content.adventure-ambient-events', 'content.quest-script',
        'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2', 'content.dialogue-pass.act-3',
        'quality.adventure-review',
      ] : []
  const integrationArtifactKeys = brief.intent.productType === 'ttrpg'
    ? ['ttrpg.rule-pack', 'ttrpg.campaign-pack', 'runtime.package']
    : ['runtime.package']
  tasks.push(productionTask({
    taskKey: 'integration.package', lane: 'integration', kind: 'runtime-package',
    skillId: null, executionMode: 'deterministic', dependsOn: integrationDependencies,
    inputArtifactKeys: [
      'content.narrative', 'content.product-module', ...textAdventureIntegrationArtifactKeys,
      'media.requirements', ...(textAdventure ? ['media.visual-bible'] : []),
      ...(textAdventure && activeVisual ? ['media.anchor-decision'] : []),
      ...(textAdventure && activeVisual ? ['media.audit'] : []),
      ...(textAdventure && activeVisual ? ['quality.visual-review'] : []),
      ...visualArtifactKeys, ...audioArtifactKeys,
    ],
    outputArtifactKeys: integrationArtifactKeys, requirementKeys: [],
    capabilityRequirementKeys: transcodeCapabilities, concurrencyGroup: 'deterministic',
    subjectLockKeys: integrationArtifactKeys, priority: 50,
    budgetReservation: reservation({ inputTokens: perInput, durationMs: perDuration }), maxAttempts: 1,
    timeoutMs: 120_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['package.protocol', 'package.graph', 'package.media-bindings'],
  }))
  if (textAdventure) tasks.push(productionTask({
    taskKey: 'qa.autoplay', lane: 'qa', kind: 'text-adventure-autoplay', skillId: null,
    executionMode: 'deterministic', dependsOn: ['integration.package'],
    inputArtifactKeys: ['runtime.package'], outputArtifactKeys: ['quality.autoplay'],
    requirementKeys: [], capabilityRequirementKeys: [], concurrencyGroup: 'deterministic',
    subjectLockKeys: ['quality.autoplay'], priority: 20,
    budgetReservation: reservation({ durationMs: perDuration }), maxAttempts: 1,
    timeoutMs: 120_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['artifact.protocol', 'adventure.autoplay.executed'],
  }))
  tasks.push(productionTask({
    taskKey: 'qa.release', lane: 'qa', kind: 'quality-review', skillId: null,
    executionMode: 'deterministic', dependsOn: [
      'integration.package', ...(textAdventure ? ['qa.autoplay'] : []),
    ],
    inputArtifactKeys: [
      ...integrationArtifactKeys, ...(textAdventure ? ['quality.autoplay'] : []),
    ], outputArtifactKeys: ['quality.report'],
    requirementKeys: [], capabilityRequirementKeys: [], concurrencyGroup: 'deterministic',
    subjectLockKeys: ['quality.report'], priority: 10,
    budgetReservation: reservation({ durationMs: perDuration }), maxAttempts: 1,
    timeoutMs: 120_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: brief.completionContract.requiredGateIds,
  }))
  if (textAdventure) tasks.push(productionTask({
    taskKey: 'qa.playtest-strategy', lane: 'qa', kind: 'text-adventure-playtest-strategy',
    skillId: 'text-adventure.playtest-strategy.v1', executionMode: 'model',
    dependsOn: ['qa.autoplay', 'qa.release'],
    inputArtifactKeys: ['runtime.package', 'quality.autoplay', 'quality.report'],
    outputArtifactKeys: ['quality.playtest-plan'], requirementKeys: [],
    capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
    subjectLockKeys: ['quality.playtest-plan'], priority: 5,
    budgetReservation: modelBudget('qa.playtest-strategy'), maxAttempts: 2,
    timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['artifact.protocol', 'adventure.playtest-strategy'],
  }))
  return parseProductProductionPlanV3({
    schema: 'storyforge.product-production-plan', version: 3,
    buildNumber: input.buildNumber, productType: brief.intent.productType,
    briefHash: input.briefHash, controlEpoch,
    concurrency: {
      maximumCostBearingTasks: 3,
      maximumTextProviderTasks: 2,
      maximumMediaProviderTasks: 1,
    },
    tasks, terminalTaskKey: textAdventure ? 'qa.playtest-strategy' : 'qa.release',
  }, brief, input.briefHash)
}
