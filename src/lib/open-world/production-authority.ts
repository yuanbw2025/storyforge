import type {
  ProductBuildRecordV1,
  ProductProductionBriefRecordV1,
  ProductProductionCommandRecordV1,
  ProductProductionPlanTaskV3,
  ProductProductionPlanV3,
  ProductProductionRecordV1,
  TextOpenWorldProductionTaskContractV1,
  WorkspaceScope,
} from '../types'
import { db } from '../db/schema'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { assertRecordInScope } from '../workspace/scope'
import {
  TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1,
  TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1,
  createTextOpenWorldProductionPlanV1,
} from './production-contract'
import { readTextOpenWorldCreatorExecutionBriefV1 } from './creator-production-start'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const MAX_PRODUCTION_AUTHORITY_COMMAND_ROWS = 65_536

export interface TextOpenWorldProductionTaskAuthorityV1 {
  taskKey: string
  valid: boolean
  validatorId: string | null
  diagnostic: string | null
}

export interface TextOpenWorldProductionPlanAuthorityV1 {
  valid: boolean
  diagnostic: string | null
  origin: 'structural-only' | 'creator-start-v1' | 'creator-repair-v1' | 'creator-media-v1' | 'invalid'
  authorityReceiptHash: string | null
  tasks: ReadonlyMap<string, TextOpenWorldProductionTaskAuthorityV1>
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function validReceipts(task: ProductProductionPlanTaskV3): boolean {
  return task.requiredReceipts.length === task.dependsOn.length
    && task.requiredReceipts.every((receipt, index) => (
      receipt.taskKey === task.dependsOn[index]
      && (receipt.receiptHash === null || isSha256Hash(receipt.receiptHash))
    ))
}

function commonTaskError(
  task: ProductProductionPlanTaskV3,
  contract: TextOpenWorldProductionTaskContractV1,
  expectedPriority: number,
): string | null {
  if (task.lane !== contract.lane || task.kind !== `text-open-world.${contract.taskKey}`
    || task.skillId !== contract.skillId || task.executionMode !== contract.executionMode) {
    return 'lane/kind/Skill/executionMode 与官方任务合同不一致'
  }
  if (!validReceipts(task) || !sameStrings(task.subjectLockKeys, task.outputArtifactKeys)
    || task.priority !== expectedPriority || task.maxAttempts !== contract.retryPolicy.maxAttempts
    || task.failurePolicy !== contract.failurePolicy || task.fallbackTaskKey !== null
    || task.reuse !== null) {
    return 'receipt/subject lock/priority/retry/failure/reuse 与官方任务合同不一致'
  }
  if (task.timeoutMs !== Math.max(1, Math.min(contract.timeoutMs, task.budgetReservation.durationMs))) {
    return 'timeout 未闭合到官方任务合同与冻结预算'
  }
  if (new Set(task.acceptanceGateIds).size !== task.acceptanceGateIds.length
    || contract.completion.requiredGateIds.some(gate => !task.acceptanceGateIds.includes(gate))) {
    return '缺少官方必需 completion gate 或 gate 重复'
  }
  if (task.executionMode === 'model') {
    if (task.concurrencyGroup !== 'text-provider'
      || task.budgetReservation.modelCalls !== contract.recommendedModelCalls
      || task.budgetReservation.inputTokens < 1 || task.budgetReservation.outputTokens < 1
      || task.budgetReservation.mediaCalls !== 0
      || task.capabilityRequirementKeys.some(key => !STABLE_KEY.test(key))) {
      return '模型并发组、调用/token预算或能力绑定不符合官方合同'
    }
  } else if (task.concurrencyGroup !== 'deterministic'
    || task.budgetReservation.modelCalls !== 0
    || task.budgetReservation.inputTokens !== 0 || task.budgetReservation.outputTokens !== 0
    || task.budgetReservation.mediaCalls !== 0
    || task.capabilityRequirementKeys.length !== 0) {
    return '确定性任务携带了非官方模型、媒资或能力预算'
  }
  return null
}

function consecutiveKeys(prefix: string, width: number, values: readonly string[]): boolean {
  return values.length > 0 && values.every((value, index) => (
    value === `${prefix}.${String(index + 1).padStart(width, '0')}`
  ))
}

function mediaTaskError(
  task: ProductProductionPlanTaskV3,
  media: 'visual' | 'audio',
): string | null {
  const visual = media === 'visual'
  const expectedOutputs = task.outputArtifactKeys
  const expectedPrefix = visual ? 'text-open-world.media.visual' : 'text-open-world.media.audio'
  if (task.taskKey !== `media.${media}` || task.lane !== media
    || task.kind !== `text-open-world.${visual ? 'image' : 'audio'}-bundle`
    || task.skillId !== 'product-production.media-request.v1'
    || task.executionMode !== 'media-provider'
    || !sameStrings(task.dependsOn, ['p10.system-finalize'])
    || !sameStrings(task.inputArtifactKeys, ['text-open-world.media-requirements'])
    || !consecutiveKeys(expectedPrefix, 3, expectedOutputs)
    || !sameStrings(task.subjectLockKeys, expectedOutputs)
    || !validReceipts(task) || task.concurrencyGroup !== 'media-provider'
    || task.priority !== 50 || task.maxAttempts !== 2
    || task.timeoutMs !== Math.max(1, Math.min(600_000, task.budgetReservation.durationMs))
    || task.failurePolicy !== 'pause' || task.fallbackTaskKey !== null
    || !sameStrings(task.acceptanceGateIds, ['media.integrity', 'media.rights'])
    || task.reuse !== null || task.budgetReservation.modelCalls !== 0
    || task.budgetReservation.inputTokens !== 0 || task.budgetReservation.outputTokens !== 0
    || task.budgetReservation.mediaCalls !== expectedOutputs.length
    || task.requirementKeys.some(key => typeof key !== 'string' || !key.trim())
    || task.capabilityRequirementKeys.some(key => !STABLE_KEY.test(key))) {
    return '媒资任务未闭合到官方 provider、输出、预算、gate 或依赖合同'
  }
  return null
}

/**
 * Recognizes the exact product-owned P0→QA plan shape. This deliberately does
 * not accept an arbitrary self-declared Plan/gate set as product authority.
 * Narrative taste remains a later playtest concern; this contract only proves
 * that accepted output came through the registered production topology.
 */
export function inspectTextOpenWorldProductionPlanAuthorityV1(
  plan: ProductProductionPlanV3,
): TextOpenWorldProductionPlanAuthorityV1 {
  const result = new Map<string, TextOpenWorldProductionTaskAuthorityV1>()
  const contracts = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1
  const contractByKey = new Map(contracts.map(contract => [contract.taskKey, contract]))
  const taskByKey = new Map(plan.tasks.map(task => [task.taskKey, task]))
  const extras = plan.tasks.filter(task => !contractByKey.has(task.taskKey))
  let planError: string | null = null
  if (plan.schema !== 'storyforge.product-production-plan' || plan.version !== 3
    || plan.productType !== 'text-open-world' || plan.terminalTaskKey !== 'qa.release'
    || plan.concurrency.maximumCostBearingTasks !== 3
    || plan.concurrency.maximumTextProviderTasks !== 2
    || plan.concurrency.maximumMediaProviderTasks !== 1
    || taskByKey.size !== plan.tasks.length
    || contracts.some(contract => !taskByKey.has(contract.taskKey))
    || extras.some(task => !['media.visual', 'media.audio'].includes(task.taskKey))
    || extras.length > 2) {
    planError = 'Plan 不是完整且唯一的官方 P0→QA 拓扑'
  }

  const p0 = taskByKey.get('p0.source-lock')
  const sourceUnitKeys = p0?.outputArtifactKeys.slice(1) ?? []
  if (!p0 || p0.outputArtifactKeys[0] !== 'text-open-world.source-pin'
    || sourceUnitKeys.length < 1
    || sourceUnitKeys.length > TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1.maximumUnits
    || !sourceUnitKeys.every((key, index) => key === (index === 0
      ? 'text-open-world.source-pin-unit'
      : `text-open-world.source-pin-unit.${String(index + 1).padStart(5, '0')}`))) {
    planError ??= 'P0 SourcePin 输出不是官方连续有界闭包'
  }
  const p1 = taskByKey.get('p1.source-curation')
  if (!p1 || !sameStrings(p1.inputArtifactKeys, ['text-open-world.source-pin', ...sourceUnitKeys])) {
    planError ??= 'P1 未精确读取 P0 的完整来源单元集合'
  }

  const mediaTasks = (['media.visual', 'media.audio'] as const)
    .flatMap(key => taskByKey.get(key) ?? [])
  const mediaOutputs = mediaTasks.flatMap(task => task.outputArtifactKeys)
  const v3 = taskByKey.get('v3.runtime-package')
  const v3Contract = contractByKey.get('v3.runtime-package')!
  if (!v3 || !sameStrings(v3.dependsOn, [...v3Contract.dependsOn, ...mediaTasks.map(task => task.taskKey)])
    || !sameStrings(v3.inputArtifactKeys, [...v3Contract.inputArtifactKeys, ...mediaOutputs])) {
    planError ??= 'V3 未精确汇合官方内容与媒资任务'
  }

  for (const [index, contract] of contracts.entries()) {
    const task = taskByKey.get(contract.taskKey)
    let error = task ? commonTaskError(task, contract, 1_000 - index * 10) : '任务缺失'
    if (!error && task) {
      const expectedDepends = contract.taskKey === 'v3.runtime-package'
        ? [...contract.dependsOn, ...mediaTasks.map(item => item.taskKey)] : contract.dependsOn
      const expectedInputs = contract.taskKey === 'p1.source-curation'
        ? ['text-open-world.source-pin', ...sourceUnitKeys]
        : contract.taskKey === 'v3.runtime-package'
          ? [...contract.inputArtifactKeys, ...mediaOutputs] : contract.inputArtifactKeys
      const expectedOutputs = contract.taskKey === 'p0.source-lock'
        ? ['text-open-world.source-pin', ...sourceUnitKeys] : contract.outputArtifactKeys
      if (!sameStrings(task.dependsOn, expectedDepends)
        || !sameStrings(task.inputArtifactKeys, expectedInputs)
        || !sameStrings(task.outputArtifactKeys, expectedOutputs)
        || task.requirementKeys.length !== 0
        || (contract.taskKey !== 'qa.release'
          && !sameStrings(task.acceptanceGateIds, contract.completion.requiredGateIds))) {
        error = '依赖、输入、输出、requirements 或 gate 与官方任务合同不一致'
      }
    }
    if (error) planError ??= `${contract.taskKey}: ${error}`
    result.set(contract.taskKey, {
      taskKey: contract.taskKey,
      valid: error == null,
      validatorId: error == null ? `text-open-world.${contract.taskKey}.production-contract.v1` : null,
      diagnostic: error,
    })
  }
  for (const media of ['visual', 'audio'] as const) {
    const task = taskByKey.get(`media.${media}`)
    if (!task) continue
    const error = mediaTaskError(task, media)
    if (error) planError ??= `${task.taskKey}: ${error}`
    result.set(task.taskKey, {
      taskKey: task.taskKey,
      valid: error == null,
      validatorId: error == null ? `text-open-world.${task.taskKey}.production-contract.v1` : null,
      diagnostic: error,
    })
  }
  if (planError) {
    for (const [key, task] of result) result.set(key, {
      ...task,
      valid: false,
      validatorId: null,
      diagnostic: task.diagnostic ?? planError,
    })
  }
  return {
    valid: planError == null,
    diagnostic: planError,
    origin: 'structural-only',
    authorityReceiptHash: null,
    tasks: result,
  }
}

function invalidateOriginAuthorityV1(
  structural: TextOpenWorldProductionPlanAuthorityV1,
  diagnostic: string,
): TextOpenWorldProductionPlanAuthorityV1 {
  return {
    valid: false,
    diagnostic,
    origin: 'invalid',
    authorityReceiptHash: null,
    tasks: new Map([...structural.tasks].map(([taskKey, task]) => [taskKey, {
      ...task,
      valid: false,
      validatorId: null,
      diagnostic: task.diagnostic ?? diagnostic,
    }])),
  }
}

function exactCreatorStartResultV1(value: string): Record<string, unknown> | null {
  try {
    const row = JSON.parse(value) as unknown
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null
    const result = row as Record<string, unknown>
    const keys = ['buildId', 'buildNumber', 'briefRevision', 'briefHash', 'sourcePlanHash', 'planHash', 'startHash']
    if (Object.keys(result).length !== keys.length
      || keys.some(key => !Object.prototype.hasOwnProperty.call(result, key))
      || canonicalProductProductionJsonV2(result) !== value) return null
    return result
  } catch {
    return null
  }
}

/**
 * Upgrades a structurally official-looking Plan to production authority only
 * when it can be rebuilt from the frozen Creator Brief/SourcePlan/Start chain
 * and matched to the one successful durable start-command receipt.
 */
async function verifyTextOpenWorldProductionPlanAuthorityV1(input: {
  production: ProductProductionRecordV1 & { id: number }
  build: ProductBuildRecordV1 & { id: number }
  briefRow: (ProductProductionBriefRecordV1 & { id: number }) | null
  startCommand: (ProductProductionCommandRecordV1 & { id: number }) | null
  plan: ProductProductionPlanV3
}): Promise<TextOpenWorldProductionPlanAuthorityV1> {
  const structural = inspectTextOpenWorldProductionPlanAuthorityV1(input.plan)
  if (!structural.valid) return structural
  try {
    const { production, build, briefRow, startCommand, plan } = input
    if (!briefRow || !startCommand
      || production.currentBuildNumber !== build.buildNumber
      || production.currentBriefRevision !== build.briefRevision
      || build.productionId !== production.id
      || briefRow.productionId !== production.id
      || briefRow.revision !== build.briefRevision
      || briefRow.briefHash !== build.briefHash
      || briefRow.briefKind !== 'text-open-world-creator-v1'
      || briefRow.status !== 'authorized'
      || briefRow.authorizedAt == null
      || startCommand.productionId !== production.id
      || startCommand.projectId !== production.projectId
      || startCommand.worldId !== production.worldId
      || startCommand.workId !== production.workId
      || startCommand.type !== 'authorize-text-open-world-creator-start'
      || startCommand.status !== 'succeeded'
      || startCommand.errorCode !== null
      || startCommand.expectedStateRevision == null
      || startCommand.completedAt == null
      || startCommand.createdAt > startCommand.completedAt
      || !isSha256Hash(startCommand.payloadHash)) {
      throw new Error('Creator Brief、Build 或成功启动命令身份不闭合')
    }
    const contracts = await readTextOpenWorldCreatorExecutionBriefV1({
      briefRow,
      planJson: build.planJson,
    })
    const expectedInitialPlan = await createTextOpenWorldProductionPlanV1({
      buildNumber: build.buildNumber,
      controlEpoch: contracts.start.productionPlanControlEpoch,
      brief: contracts.executionBrief,
      briefHash: contracts.start.executionBriefHash,
      authoritativeBriefHash: contracts.creatorBrief.briefHash,
      sourceUnitArtifactKeys: contracts.sourcePlan.sourceUnitArtifactKeys,
      sourceTotalChars: contracts.sourcePlan.sourceKind === 'world-release'
        ? 0 : TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1.maximumTotalChars,
      mediaCostAuthorized: false,
    })
    const expectedInitialHash = await hashProductProductionValueV2(expectedInitialPlan)
    const expectedCurrentPlan = {
      ...expectedInitialPlan,
      controlEpoch: build.controlEpoch,
    }
    if (expectedInitialHash !== contracts.start.productionPlanHash
      || canonicalProductProductionJsonV2(expectedCurrentPlan) !== canonicalProductProductionJsonV2(plan)
      || canonicalProductProductionJsonV2(plan) !== build.planJson
      || await hashProductProductionValueV2(plan) !== build.planHash
      || build.authorizedAt !== contracts.start.authorizedAt
      || briefRow.authorizedAt !== contracts.start.authorizedAt
      || startCommand.expectedStateRevision !== contracts.start.authorStartRevision) {
      throw new Error('当前 Plan 不能由作者冻结输入和官方编译器逐字节重建')
    }
    const commandResult = exactCreatorStartResultV1(startCommand.resultJson)
    if (!commandResult
      || !Number.isSafeInteger(commandResult.buildId)
      || commandResult.buildId !== build.id
      || commandResult.buildNumber !== build.buildNumber
      || commandResult.briefRevision !== briefRow.revision
      || commandResult.briefHash !== contracts.creatorBrief.briefHash
      || commandResult.sourcePlanHash !== contracts.sourcePlan.planHash
      || commandResult.planHash !== contracts.start.productionPlanHash
      || commandResult.startHash !== contracts.start.startHash) {
      throw new Error('成功启动命令回执与 Creator 冻结链不一致')
    }
    const authorityReceiptHash = await hashProductProductionValueV2({
      schema: 'storyforge.text-open-world-production-plan-authority-receipt',
      version: 1,
      productionId: production.id,
      productionKey: production.productionKey,
      buildId: build.id,
      buildNumber: build.buildNumber,
      controlEpoch: build.controlEpoch,
      briefRevision: briefRow.revision,
      creatorBriefHash: contracts.creatorBrief.briefHash,
      sourcePlanHash: contracts.sourcePlan.planHash,
      startHash: contracts.start.startHash,
      initialPlanHash: expectedInitialHash,
      currentPlanHash: build.planHash,
      startCommand: { ...startCommand, id: startCommand.id },
    })
    const authority: TextOpenWorldProductionPlanAuthorityV1 = {
      ...structural,
      origin: 'creator-start-v1',
      authorityReceiptHash,
    }
    return authority
  } catch (cause) {
    return invalidateOriginAuthorityV1(
      structural,
      cause instanceof Error ? cause.message : 'Creator 生产来源权威无法验证',
    )
  }
}

export interface TextOpenWorldProductionPlanAuthoritySnapshotV1 {
  authority: TextOpenWorldProductionPlanAuthorityV1
  evidenceHash: string
  production: ProductProductionRecordV1 & { id: number }
  build: ProductBuildRecordV1 & { id: number }
  plan: ProductProductionPlanV3
}

/**
 * The only public upgrade path from structural inspection to Creator production
 * authority. Every authority-bearing value is reconstructed from rows read from
 * IndexedDB here; callers cannot submit a self-consistent in-memory row set.
 */
export async function readTextOpenWorldProductionPlanAuthorityV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
}): Promise<TextOpenWorldProductionPlanAuthoritySnapshotV1> {
  const { scope } = input
  const [productionValue, buildValue] = await Promise.all([
    db.productProductions.get(input.productionId),
    db.productBuilds.get(input.buildId),
  ])
  if (!productionValue?.id || !buildValue?.id
    || !await assertRecordInScope(scope, 'productProductions', productionValue, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productBuilds', buildValue, { owner: 'work' })
    || productionValue.productType !== 'text-open-world'
    || buildValue.productionId !== productionValue.id
    || productionValue.currentBuildNumber !== buildValue.buildNumber) {
    throw new Error('[text-open-world-production-authority] 当前 Production/Build 不存在或作用域不闭合')
  }
  const production = productionValue as ProductProductionRecordV1 & { id: number }
  const build = buildValue as ProductBuildRecordV1 & { id: number }
  const plan = parseProductProductionPlanV3(build.planJson, undefined, build.briefHash)
  if (plan.buildNumber !== build.buildNumber || plan.controlEpoch !== build.controlEpoch
    || build.planHash !== await hashProductProductionValueV2(plan)) {
    throw new Error('[text-open-world-production-authority] 当前 Build Plan 身份不闭合')
  }
  if (build.parentBuildNumber != null) {
    try {
      const { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } = await import(
        './creator-derived-authority'
      )
      const derived = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
        scope,
        buildId: build.id,
      })
      const structuralPlan = {
        ...derived.productionPlan,
        tasks: derived.productionPlan.tasks.map(task => ({ ...task, reuse: null })),
      }
      const structural = inspectTextOpenWorldProductionPlanAuthorityV1(structuralPlan)
      if (!structural.valid) throw new Error(structural.diagnostic ?? '派生 Creator Plan 结构不合法')
      const authorityReceiptHash = await hashProductProductionValueV2({
        schema: 'storyforge.text-open-world-production-derived-authority-receipt',
        version: 1,
        origin: derived.origin,
        authorizationHash: derived.authorizationHash,
        commandChain: derived.commandChain.map(command => ({
          commandId: command.commandId,
          payloadHash: command.payloadHash,
          expectedStateRevision: command.expectedStateRevision,
          completedAt: command.completedAt,
        })),
        targetBuildNumber: derived.build.buildNumber,
        targetPlanHash: derived.build.planHash,
      })
      return {
        authority: {
          ...structural,
          origin: derived.origin,
          authorityReceiptHash,
        },
        evidenceHash: await hashProductProductionValueV2({
          schema: 'storyforge.text-open-world-governance-production-derived-authority-evidence',
          version: 1,
          origin: derived.origin,
          production: { ...derived.production, id: derived.production.id },
          targetBuild: { ...derived.build, id: derived.build.id },
          brief: { ...derived.briefRow, id: derived.briefRow.id },
          commandChain: derived.commandChain.map(command => ({ ...command, id: command.id })),
          authorizationHash: derived.authorizationHash,
          authorization: derived.repair?.authorization ?? derived.media?.authorization ?? null,
        }),
        production: derived.production,
        build: derived.build,
        plan: derived.productionPlan,
      }
    } catch (cause) {
      return {
        authority: invalidateOriginAuthorityV1(
          inspectTextOpenWorldProductionPlanAuthorityV1({
            ...plan,
            tasks: plan.tasks.map(task => ({ ...task, reuse: null })),
          }),
          cause instanceof Error ? cause.message : 'Creator 派生 Build 权威无法验证',
        ),
        evidenceHash: await hashProductProductionValueV2({
          schema: 'storyforge.text-open-world-governance-production-derived-authority-invalid',
          version: 1,
          productionId: production.id,
          buildId: build.id,
          planHash: build.planHash,
        }),
        production,
        build,
        plan,
      }
    }
  }
  const brief = await db.productProductionBriefs
    .where('[productionId+revision]')
    .equals([production.id, build.briefRevision])
    .first()
  if (brief && (!await assertRecordInScope(
    scope, 'productProductionBriefs', brief, { owner: 'work' },
  ) || brief.productionId !== production.id)) {
    throw new Error('[text-open-world-production-authority] Creator Brief 作用域完整性错误')
  }
  const commandRows = await db.productProductionCommands
    .where('[productionId+status]')
    .equals([production.id, 'succeeded'])
    .filter(row => row.type === 'authorize-text-open-world-creator-start')
    .limit(MAX_PRODUCTION_AUTHORITY_COMMAND_ROWS + 1)
    .toArray()
  if (commandRows.length > MAX_PRODUCTION_AUTHORITY_COMMAND_ROWS) {
    throw new Error('[text-open-world-production-authority] Creator Start 命令历史超过安全上限')
  }
  for (const command of commandRows) {
    if (!await assertRecordInScope(
      scope, 'productProductionCommands', command, { owner: 'work' },
    ) || command.productionId !== production.id) {
      throw new Error('[text-open-world-production-authority] Creator Start 命令作用域完整性错误')
    }
  }
  const briefRow = brief?.id == null
    ? null : brief as ProductProductionBriefRecordV1 & { id: number }
  const matchingCommands = briefRow == null ? [] : commandRows.filter(command => {
    try {
      const result = JSON.parse(command.resultJson) as Record<string, unknown>
      return result.buildId === build.id
        && result.buildNumber === build.buildNumber
        && result.briefRevision === build.briefRevision
        && result.briefHash === build.briefHash
        && result.sourcePlanHash === briefRow.sourcePlanHash
        && result.startHash === briefRow.confirmedBriefHash
    } catch {
      return false
    }
  })
  const startCommand = matchingCommands.length === 1 && matchingCommands[0].id != null
    ? matchingCommands[0] as ProductProductionCommandRecordV1 & { id: number }
    : null
  const authority = await verifyTextOpenWorldProductionPlanAuthorityV1({
    production,
    build,
    briefRow,
    startCommand,
    plan,
  })
  return {
    authority,
    evidenceHash: await hashProductProductionValueV2({
      schema: 'storyforge.text-open-world-governance-production-authority-evidence',
      version: 1,
      production: { ...production, id: production.id },
      build: { ...build, id: build.id },
      brief: briefRow == null ? null : { ...briefRow, id: briefRow.id },
      commands: commandRows.map(row => ({ ...row, id: row.id ?? null }))
        .sort((left, right) => (left.id ?? -1) - (right.id ?? -1)),
    }),
    production,
    build,
    plan,
  }
}
