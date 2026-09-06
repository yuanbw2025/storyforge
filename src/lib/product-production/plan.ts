import type {
  ProductProductionBriefV3,
  ProductProductionPlanTaskV3,
  ProductProductionPlanV3,
  ProductTaskBudgetReservationV1,
} from '../types'
import { PRODUCTION_PRODUCT_KINDS_V1 } from '../types'
import { parseProductProductionBriefV3 } from './contracts'
import { hashProductProductionValueV2, isSha256Hash } from './hash'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const LANES = ['planning', 'content', 'visual', 'audio', 'integration', 'qa'] as const
const EXECUTION_MODES = ['deterministic', 'model', 'media-provider', 'human-import'] as const
const FAILURE_POLICIES = ['fail-build', 'pause', 'fallback', 'skip-optional'] as const

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
    if (totals.modelCalls > budget.maximumModelCalls || totals.inputTokens > budget.maximumInputTokens
      || totals.outputTokens > budget.maximumOutputTokens || totals.mediaCalls > budget.maximumMediaCalls
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
  const modelTaskCount = textAdventure ? 20 : 4
  const textAdventureOutputWeights: Record<string, number> = {
    'content.source-sufficiency': 0.05,
    'content.design': 0.04,
    'content.story-bible': 0.07,
    'content.cast-bible': 0.09,
    'content.adventure-architecture': 0.07,
    'content.product-module': 0.07,
    'content.narrative-arc-plan': 0.07,
    'content.main-quest-plan': 0.08,
    'content.quest-script': 0.05,
    'content.scene-script.act-1': 0.05,
    'content.scene-script.act-2': 0.05,
    'content.scene-script.act-3': 0.05,
    'content.dialogue-pass.act-1': 0.02,
    'content.dialogue-pass.act-2': 0.02,
    'content.dialogue-pass.act-3': 0.02,
    'content.adventure-side-quests': 0.06,
    'content.adventure-ambient-events': 0.04,
    'content.adventure-quality-review': 0.04,
    'media.requirements': 0.04,
    'qa.playtest-strategy': 0.02,
  }
  // Every provider task and deterministic integration receives a declared
  // slice. Text adventure reserves separate bounded specialists for the
  // architecture, mainline, side content, ambient events and systems.
  const perInput = Math.floor(brief.productionBudget.maximumInputTokens / (modelTaskCount + 1))
  const perOutput = Math.floor(brief.productionBudget.maximumOutputTokens / modelTaskCount)
  const activeMediaTaskCount = textAdventure
    ? visualArtifactKeys.length + audioArtifactKeys.length
    : activeMediaLaneCount
  const durationSlots = modelTaskCount + (textAdventure ? 5 : 4) + activeMediaTaskCount
  const perDuration = Math.floor(brief.productionBudget.maximumDurationMs / Math.max(1, durationSlots))
  const costTaskCount = modelTaskCount + activeMediaTaskCount
  const perCost = brief.productionBudget.maximumCostUsd == null
    ? null
    : brief.productionBudget.maximumCostUsd / Math.max(1, costTaskCount)
  const mediaStorage = activeMediaTaskCount === 0
    ? 0
    : Math.floor(brief.productionBudget.maximumStorageBytes / activeMediaTaskCount)

  const modelBudget = (taskKey: string) => reservation({
    modelCalls: 1, inputTokens: perInput,
    outputTokens: textAdventure
      ? Math.floor(brief.productionBudget.maximumOutputTokens * textAdventureOutputWeights[taskKey])
      : perOutput,
    maximumCostUsd: perCost,
    durationMs: perDuration,
  })
  const tasks: ProductProductionPlanTaskV3[] = []
  if (textAdventure) tasks.push(productionTask({
    taskKey: 'content.source-sufficiency', lane: 'planning', kind: 'text-adventure-source-sufficiency',
    skillId: 'text-adventure.source-sufficiency.v1', executionMode: 'model', dependsOn: [],
    inputArtifactKeys: [], outputArtifactKeys: ['content.source-sufficiency'], requirementKeys: [],
    capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
    subjectLockKeys: ['content.source-sufficiency'], priority: 110, budgetReservation: modelBudget('content.source-sufficiency'),
    maxAttempts: 2, timeoutMs: 180_000, failurePolicy: 'pause', fallbackTaskKey: null,
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
    executionMode: 'model', dependsOn: textAdventure ? ['source.author-gate'] : [],
    inputArtifactKeys: textAdventure ? ['content.source-sufficiency', 'content.source-decision'] : [],
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
      taskKey: 'content.narrative-arc-plan', lane: 'planning', kind: 'text-adventure-narrative-arc-plan',
      skillId: 'text-adventure.narrative-arc-plan.v1', executionMode: 'model',
      dependsOn: ['content.story-bible', 'content.cast-bible', 'content.adventure-architecture', 'content.product-module'],
      inputArtifactKeys: ['content.story-bible', 'content.cast-bible', 'content.adventure-architecture', 'content.product-module'],
      outputArtifactKeys: ['content.narrative-arc-plan'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.narrative-arc-plan'], priority: 90, budgetReservation: modelBudget('content.narrative-arc-plan'),
      maxAttempts: 2, timeoutMs: 300_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'adventure.narrative-arc-plan'],
    }),
    productionTask({
      taskKey: 'content.main-quest-plan', lane: 'planning', kind: 'text-adventure-main-quest-plan',
      skillId: 'text-adventure.production-mainline.v1', executionMode: 'model',
      dependsOn: ['content.story-bible', 'content.cast-bible', 'content.product-module', 'content.narrative-arc-plan'],
      inputArtifactKeys: ['content.story-bible', 'content.cast-bible', 'content.product-module', 'content.narrative-arc-plan'],
      outputArtifactKeys: ['content.main-quest-plan'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.main-quest-plan'], priority: 88, budgetReservation: modelBudget('content.main-quest-plan'),
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
  if (textAdventure) tasks.push(productionTask({
    taskKey: 'content.quest-script', lane: 'content', kind: 'text-adventure-quest-script',
    skillId: 'text-adventure.quest-script.v1', executionMode: 'model',
    dependsOn: [
      'content.story-bible', 'content.cast-bible', 'content.product-module',
      'content.narrative-arc-plan', 'content.main-quest-plan',
      'content.adventure-side-quests', 'content.adventure-ambient-events',
    ],
    inputArtifactKeys: [
      'content.story-bible', 'content.cast-bible', 'content.product-module',
      'content.narrative-arc-plan', 'content.main-quest-plan',
      'content.adventure-side-quests', 'content.adventure-ambient-events',
    ],
    outputArtifactKeys: ['content.quest-script'], requirementKeys: [],
    capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
    subjectLockKeys: ['content.quest-script'], priority: 78, budgetReservation: modelBudget('content.quest-script'),
    maxAttempts: 2, timeoutMs: 300_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['artifact.protocol', 'adventure.quest-script'],
  }))
  if (textAdventure) {
    const sceneScriptDependencies = [
      'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
      'content.product-module', 'content.narrative-arc-plan',
      'content.main-quest-plan', 'content.adventure-side-quests', 'content.adventure-ambient-events',
      'content.quest-script',
    ]
    for (let act = 1; act <= 3; act += 1) {
      const taskKey = `content.scene-script.act-${act}`
      tasks.push(productionTask({
        taskKey, lane: 'content', kind: 'text-adventure-scene-script-bundle',
        skillId: 'text-adventure.scene-script.v1', executionMode: 'model',
        dependsOn: sceneScriptDependencies,
        inputArtifactKeys: sceneScriptDependencies,
        outputArtifactKeys: [taskKey], requirementKeys: [],
        capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
        subjectLockKeys: [taskKey], priority: 77 - act, budgetReservation: modelBudget(taskKey),
        maxAttempts: 2, timeoutMs: 600_000, failurePolicy: 'pause', fallbackTaskKey: null,
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
      'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
      'content.product-module', 'content.narrative-arc-plan', 'content.main-quest-plan',
      'content.adventure-side-quests', 'content.adventure-ambient-events', 'content.quest-script',
      'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2',
      'content.dialogue-pass.act-3', 'integration.narrative',
    ],
    inputArtifactKeys: [
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
  const mediaDependencies: string[] = []
  if (activeVisual) {
    const taskKeys = textAdventure ? visualArtifactKeys : ['media.visual']
    mediaDependencies.push(...taskKeys)
    for (const taskKey of taskKeys) tasks.push(productionTask({
      taskKey, lane: 'visual', kind: textAdventure ? 'image-asset' : 'image-bundle',
      skillId: 'product-production.media-request.v1', executionMode: 'media-provider',
      dependsOn: ['media.requirements'], inputArtifactKeys: ['media.requirements'],
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
  const textAdventureDependencies = textAdventure
    ? [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.narrative-arc-plan', 'content.main-quest-plan', 'content.adventure-side-quests',
        'content.adventure-ambient-events', 'content.quest-script',
        'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2', 'content.dialogue-pass.act-3',
        'content.adventure-quality-review',
      ] : []
  const integrationDependencies = [
    textAdventure ? 'integration.narrative' : 'content.narrative', 'content.product-module', ...textAdventureDependencies,
    'media.requirements', ...mediaDependencies,
  ]
  const textAdventureIntegrationArtifactKeys = textAdventure
    ? [
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
      'media.requirements',
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
