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
  // Four model tasks and deterministic package integration each receive a
  // declared slice. Integration reads the frozen world through Context Gateway.
  const perInput = Math.floor(brief.productionBudget.maximumInputTokens / 5)
  const perOutput = Math.floor(brief.productionBudget.maximumOutputTokens / 4)
  const perDuration = Math.floor(brief.productionBudget.maximumDurationMs / 8)
  const costTaskCount = 4 + activeMediaLaneCount
  const perCost = brief.productionBudget.maximumCostUsd == null
    ? null
    : brief.productionBudget.maximumCostUsd / Math.max(1, costTaskCount)
  const mediaStorage = activeMediaLaneCount === 0
    ? 0
    : Math.floor(brief.productionBudget.maximumStorageBytes / activeMediaLaneCount)

  const modelBudget = () => reservation({
    modelCalls: 1, inputTokens: perInput, outputTokens: perOutput,
    maximumCostUsd: perCost, durationMs: perDuration,
  })
  const tasks: ProductProductionPlanTaskV3[] = [
    productionTask({
      taskKey: 'content.design', lane: 'content', kind: 'product-design',
      skillId: 'product-production.content.v1', executionMode: 'model', dependsOn: [],
      inputArtifactKeys: [], outputArtifactKeys: ['design.game'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['design.game'], priority: 100, budgetReservation: modelBudget(),
      maxAttempts: 2, timeoutMs: 180_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'design.source-anchors'],
    }),
    productionTask({
      taskKey: 'content.narrative', lane: 'content', kind: 'narrative',
      skillId: 'product-production.content.v1', executionMode: 'model', dependsOn: ['content.design'],
      inputArtifactKeys: ['design.game'], outputArtifactKeys: ['content.narrative'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.narrative'], priority: 90, budgetReservation: modelBudget(),
      maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'narrative.graph'],
    }),
    productionTask({
      taskKey: 'content.product-module', lane: 'content', kind: 'product-module',
      skillId: 'product-production.content.v1', executionMode: 'model', dependsOn: ['content.design'],
      inputArtifactKeys: ['design.game'], outputArtifactKeys: ['content.product-module'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['content.product-module'], priority: 85, budgetReservation: modelBudget(),
      maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'product.module'],
    }),
    productionTask({
      taskKey: 'media.requirements', lane: 'planning', kind: 'media-requirements',
      skillId: 'product-production.media-requirements.v1', executionMode: 'model', dependsOn: ['content.design'],
      inputArtifactKeys: ['design.game'], outputArtifactKeys: ['media.requirements'], requirementKeys: [],
      capabilityRequirementKeys: textCapabilities, concurrencyGroup: 'text-provider',
      subjectLockKeys: ['media.requirements'], priority: 88, budgetReservation: modelBudget(),
      maxAttempts: 2, timeoutMs: 180_000, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: ['artifact.protocol', 'media.requirements.coverage'],
    }),
  ]
  const mediaDependencies: string[] = []
  if (activeVisual) {
    mediaDependencies.push('media.visual')
    tasks.push(productionTask({
      taskKey: 'media.visual', lane: 'visual', kind: 'image-bundle',
      skillId: 'product-production.media-request.v1', executionMode: 'media-provider',
      dependsOn: ['media.requirements'], inputArtifactKeys: ['media.requirements'],
      outputArtifactKeys: visualArtifactKeys,
      requirementKeys: brief.media.requiredMediaKinds.filter(kind => !['bgm', 'sfx', 'voice'].includes(kind)),
      capabilityRequirementKeys: imageCapabilities, concurrencyGroup: 'media-provider',
      subjectLockKeys: visualArtifactKeys, priority: 70,
      budgetReservation: reservation({
        mediaCalls: brief.media.imageCount, maximumCostUsd: perCost,
        durationMs: perDuration, storageBytes: mediaStorage,
      }),
      maxAttempts: 2, timeoutMs: 600_000,
      failurePolicy: brief.fallbackPolicy.allowTextOnly ? 'skip-optional' : 'pause',
      fallbackTaskKey: null, acceptanceGateIds: ['media.integrity', 'media.rights'],
    }))
  }
  if (activeAudio) {
    mediaDependencies.push('media.audio')
    tasks.push(productionTask({
      taskKey: 'media.audio', lane: 'audio', kind: 'audio-bundle',
      skillId: 'product-production.media-request.v1', executionMode: 'media-provider',
      dependsOn: ['media.requirements'], inputArtifactKeys: ['media.requirements'],
      outputArtifactKeys: audioArtifactKeys,
      requirementKeys: brief.media.requiredMediaKinds.filter(kind => ['bgm', 'sfx', 'voice'].includes(kind)),
      capabilityRequirementKeys: audioCapabilities, concurrencyGroup: 'media-provider',
      subjectLockKeys: audioArtifactKeys, priority: 65,
      budgetReservation: reservation({
        mediaCalls: audioCalls, maximumCostUsd: perCost,
        durationMs: perDuration, storageBytes: mediaStorage,
      }),
      maxAttempts: 2, timeoutMs: 600_000,
      failurePolicy: brief.fallbackPolicy.allowTextOnly ? 'skip-optional' : 'pause',
      fallbackTaskKey: null, acceptanceGateIds: ['media.integrity', 'media.rights'],
    }))
  }
  const integrationDependencies = [
    'content.narrative', 'content.product-module', 'media.requirements', ...mediaDependencies,
  ]
  const integrationArtifactKeys = brief.intent.productType === 'ttrpg'
    ? ['ttrpg.rule-pack', 'ttrpg.campaign-pack', 'runtime.package']
    : ['runtime.package']
  tasks.push(productionTask({
    taskKey: 'integration.package', lane: 'integration', kind: 'runtime-package',
    skillId: null, executionMode: 'deterministic', dependsOn: integrationDependencies,
    inputArtifactKeys: [
      'content.narrative', 'content.product-module', 'media.requirements',
      ...visualArtifactKeys, ...audioArtifactKeys,
    ],
    outputArtifactKeys: integrationArtifactKeys, requirementKeys: [],
    capabilityRequirementKeys: transcodeCapabilities, concurrencyGroup: 'deterministic',
    subjectLockKeys: integrationArtifactKeys, priority: 50,
    budgetReservation: reservation({ inputTokens: perInput, durationMs: perDuration }), maxAttempts: 1,
    timeoutMs: 120_000, failurePolicy: 'fail-build', fallbackTaskKey: null,
    acceptanceGateIds: ['package.protocol', 'package.graph', 'package.media-bindings'],
  }))
  tasks.push(productionTask({
    taskKey: 'qa.release', lane: 'qa', kind: 'quality-review', skillId: null,
    executionMode: 'deterministic', dependsOn: ['integration.package'],
    inputArtifactKeys: integrationArtifactKeys, outputArtifactKeys: ['quality.report'],
    requirementKeys: [], capabilityRequirementKeys: [], concurrencyGroup: 'deterministic',
    subjectLockKeys: ['quality.report'], priority: 10,
    budgetReservation: reservation({ durationMs: perDuration }), maxAttempts: 1,
    timeoutMs: 120_000, failurePolicy: 'fail-build', fallbackTaskKey: null,
    acceptanceGateIds: brief.completionContract.requiredGateIds,
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
    tasks, terminalTaskKey: 'qa.release',
  }, brief, input.briefHash)
}
