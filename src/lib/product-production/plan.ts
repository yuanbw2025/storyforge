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

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const LANES = ['planning', 'content', 'visual', 'audio', 'integration', 'qa'] as const
const EXECUTION_MODES = ['deterministic', 'model', 'media-provider', 'human-import'] as const
const FAILURE_POLICIES = ['fail-build', 'pause', 'fallback', 'skip-optional'] as const

export interface TextAdventureProductionBudgetFloorV1 {
  modelTaskCount: number
  retryReserveSlots: number
  minimumModelCalls: number
  minimumInputTokens: number
  minimumOutputTokens: number
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
  const modelTaskCount = 25 + sceneScriptPartCount + Number(activeVisual)
  const retryReserveSlots = Math.max(8, Math.ceil(modelTaskCount * 0.25))
  const minimumModelCalls = modelTaskCount + retryReserveSlots
  return {
    modelTaskCount,
    retryReserveSlots,
    minimumModelCalls,
    minimumInputTokens: Math.max(300_000, minimumModelCalls * 16_000),
    minimumOutputTokens: Math.max(
      100_000,
      brief.scale.targetWordCount * 8 + 60_000,
      brief.scale.targetPlayMinutes * 2_000 + 40_000,
      modelTaskCount * 5_000,
    ),
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
    // overbooked by at most 25%; the scheduler's append-only Build ledger is
    // still the hard authority and refuses each call once real usage plus
    // in-flight reservations would exceed the author-approved total.
    const maximumReservedOutputTokens = productType === 'text-adventure'
      ? Math.floor(budget.maximumOutputTokens * 1.25)
      : budget.maximumOutputTokens
    if (totals.modelCalls > budget.maximumModelCalls || totals.inputTokens > budget.maximumInputTokens
      || totals.outputTokens > maximumReservedOutputTokens || totals.mediaCalls > budget.maximumMediaCalls
      || totals.durationMs > budget.maximumDurationMs || totals.storageBytes > budget.maximumStorageBytes
      || (budget.maximumCostUsd != null
        && (totals.maximumCostUsd == null || totals.maximumCostUsd > budget.maximumCostUsd))) {
      fail('Plan 预算预留超过 Brief 授权')
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
    'content.narrative-arc-scenes': 0.035,
    'content.narrative-decision-plan': 0.03,
    'content.main-quest-plan': 0.035,
    // One whole act still encouraged providers to collapse multi-route
    // objectives. Each act therefore has a simple and complex Run that share
    // the same professional Skill and together keep the former 5.5% envelope.
    'content.quest-script.main.act-1.single': 0.02,
    'content.quest-script.main.act-1.multi': 0.025,
    'content.quest-script.main.act-2.single': 0.02,
    'content.quest-script.main.act-2.multi': 0.025,
    'content.quest-script.main.act-3.single': 0.02,
    'content.quest-script.main.act-3.multi': 0.025,
    'content.quest-script.supplemental': 0.03,
    // Scene prose is the player-visible product, not scaffolding. Each act's
    // 18% envelope is split into two bounded scene packets so a provider cannot
    // strand a whole act in one oversized request.
    // Real accepted scene packets are roughly 9–18 KiB. A 7% slice gives each
    // writer 11,200 tokens in the current commercial envelope and leaves room
    // for the measured reasoning overhead of upstream specialist bibles.
    'content.scene-script.act-1.part-1': 0.07,
    'content.scene-script.act-1.part-2': 0.07,
    'content.scene-script.act-2.part-1': 0.07,
    'content.scene-script.act-2.part-2': 0.07,
    'content.scene-script.act-3.part-1': 0.07,
    'content.scene-script.act-3.part-2': 0.07,
    // The provider usage receipt may include hidden reasoning. Each Dialogue
    // Editor therefore receives an 8,800-token ceiling in the repaired Brief
    // while returning only an ordinal
    // delta; the Build-lifetime ledger, not the sum of task ceilings, remains
    // the author-approved hard budget.
    'content.dialogue-pass.act-1': 0.055,
    'content.dialogue-pass.act-2': 0.055,
    'content.dialogue-pass.act-3': 0.055,
    'content.adventure-side-quests': 0.025,
    'content.adventure-ambient-events': 0.03,
    // Independent continuity review is reasoning-heavy even though its visible
    // result is a compact scorecard. Provider receipts may charge those hidden
    // reasoning tokens as output, so its task ceiling must reflect observed
    // billable usage rather than the JSON byte count alone.
    'content.adventure-quality-review': 0.075,
    'media.requirements': 0.015,
    'media.visual-quality-review': 0.005,
    'qa.playtest-strategy': 0.015,
  }
  // Most model tasks consume a similarly sized context packet. Dialogue and
  // independent whole-product review are exceptions: even after compact
  // ordinal protocols, provider receipts include the system prompt and schema
  // framing in addition to the frozen packet. Give those tasks an explicit
  // ceiling while retaining aggregate input headroom for retries. The
  // append-only Build ledger below the Plan remains the hard authority.
  const textAdventureInputWeights: Record<string, number> = {
    'content.dialogue-pass.act-1': 0.035,
    'content.dialogue-pass.act-2': 0.035,
    'content.dialogue-pass.act-3': 0.035,
    'content.adventure-quality-review': 0.075,
  }
  // Every provider task and deterministic integration receives a declared
  // slice. Text adventure reserves separate bounded specialists for the
  // architecture, mainline, side content, ambient events and systems.
  // Keep explicit Build-level retry headroom. Without it, a single unknown
  // paid call consumes one task ceiling and the remaining first attempts can
  // no longer be admitted even though every task declares bounded recovery.
  const retryReserveSlots = textAdventureBudgetFloor?.retryReserveSlots ?? 3
  const perInput = Math.floor(
    brief.productionBudget.maximumInputTokens / (modelTaskCount + retryReserveSlots),
  )
  const perOutput = Math.floor(
    brief.productionBudget.maximumOutputTokens / (modelTaskCount + retryReserveSlots),
  )
  const activeMediaTaskCount = textAdventure
    ? visualArtifactKeys.length + audioArtifactKeys.length
    : activeMediaLaneCount
  const textAdventureDeterministicTaskCount = textAdventure ? 12 + Number(activeVisual) : 4
  const durationSlots = modelTaskCount + textAdventureDeterministicTaskCount + activeMediaTaskCount
  const perDuration = Math.floor(
    brief.productionBudget.maximumDurationMs / Math.max(1, durationSlots + retryReserveSlots),
  )
  const costTaskCount = modelTaskCount + activeMediaTaskCount
  const perCost = brief.productionBudget.maximumCostUsd == null
    ? null
    : brief.productionBudget.maximumCostUsd / Math.max(1, costTaskCount + retryReserveSlots)
  const mediaStorage = activeMediaTaskCount === 0
    ? 0
    : Math.floor(brief.productionBudget.maximumStorageBytes / activeMediaTaskCount)

  const modelBudget = (taskKey: string) => reservation({
    modelCalls: 1,
    inputTokens: textAdventure && textAdventureInputWeights[taskKey] != null
      ? Math.floor(brief.productionBudget.maximumInputTokens * textAdventureInputWeights[taskKey])
      : perInput,
    outputTokens: textAdventure
      ? Math.floor(brief.productionBudget.maximumOutputTokens * textAdventureOutputWeights[taskKey])
      : perOutput,
    maximumCostUsd: perCost,
    durationMs: perDuration,
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
      maxAttempts: 2, timeoutMs: 300_000, failurePolicy: 'pause', fallbackTaskKey: null,
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
      skillId: 'product-production.content.v1', executionMode: 'model', dependsOn: ['content.design'],
      inputArtifactKeys: ['design.game'], outputArtifactKeys: ['content.product-module'], requirementKeys: [],
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
          maxAttempts: 2, timeoutMs: 300_000, failurePolicy: 'pause', fallbackTaskKey: null,
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
        maxAttempts: 2, timeoutMs: 300_000, failurePolicy: 'pause', fallbackTaskKey: null,
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
        ...sceneScriptTaskKeys, ...dialoguePassTaskKeys,
      ],
      inputArtifactKeys: [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.narrative-arc-plan',
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
  if (textAdventure) tasks.push(productionTask({
    taskKey: 'content.adventure-quality-review', lane: 'qa', kind: 'text-adventure-quality-review',
    skillId: 'text-adventure.production-quality-review.v1', executionMode: 'model',
    dependsOn: [
      'production.supervision',
      'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
      'content.product-module', 'content.narrative-arc-plan', 'content.main-quest-plan',
      'content.adventure-side-quests', 'content.adventure-ambient-events', 'content.quest-script',
      'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2',
      'content.dialogue-pass.act-3', 'integration.narrative',
    ],
    inputArtifactKeys: [
      'production.supervision',
      'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
      'content.product-module', 'content.narrative-arc-plan', 'content.main-quest-plan',
      'content.adventure-side-quests', 'content.adventure-ambient-events', 'content.quest-script',
      'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2',
      'content.dialogue-pass.act-3', 'content.narrative',
    ],
    outputArtifactKeys: ['quality.adventure-review'], requirementKeys: [],
    capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
    subjectLockKeys: ['quality.adventure-review'], priority: 75,
    budgetReservation: modelBudget('content.adventure-quality-review'),
    maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['artifact.protocol', 'adventure.narrative-quality-review'],
  }))
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
    taskKey: 'media.anchor-author-gate', lane: 'planning', kind: 'text-adventure-media-anchor-decision',
    skillId: null, executionMode: 'deterministic', dependsOn: ['media.visual-bible.compile'],
    inputArtifactKeys: ['content.cast-bible', 'media.visual-bible'],
    outputArtifactKeys: ['media.anchor-decision'], requirementKeys: [], capabilityRequirementKeys: [],
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
  if (textAdventure && activeVisual) tasks.push(productionTask({
    taskKey: 'media.visual-quality-review', lane: 'qa', kind: 'text-adventure-visual-quality-review',
    skillId: 'text-adventure.visual-quality-review.v1', executionMode: 'model', dependsOn: ['media.audit'],
    inputArtifactKeys: [
      'content.cast-bible', 'media.requirements', 'media.visual-bible', 'media.audit', ...visualArtifactKeys,
    ],
    outputArtifactKeys: ['quality.visual-review'], requirementKeys: [],
    capabilityRequirementKeys: textCapabilities,
    concurrencyGroup: 'text-provider', subjectLockKeys: ['quality.visual-review'], priority: 55,
    budgetReservation: modelBudget('media.visual-quality-review'), maxAttempts: 2,
    timeoutMs: 300_000,
    failurePolicy: brief.qualityProfile === 'commercial-candidate' ? 'pause' : 'skip-optional',
    fallbackTaskKey: null,
    acceptanceGateIds: ['artifact.protocol', 'media.visual-semantic-review-executed'],
  }))
  const textAdventureDependencies = textAdventure
    ? [
        'production.supervision',
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.narrative-arc-plan', 'content.main-quest-plan', 'content.adventure-side-quests',
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
