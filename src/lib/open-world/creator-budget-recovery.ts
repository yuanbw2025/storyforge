import { db } from '../db/schema'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 as json, hashProductProductionValueV2 as hash, isSha256Hash } from '../product-production/hash'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, ProductProductionCommandRecordV1, ProductProductionPlanV3, WorkspaceScope } from '../types'
import type { TextOpenWorldCreatorDerivedBuildAuthorityV1 } from './creator-derived-authority'
import type { VerifiedProductBuildTerminalArtifactSetV1 } from '../product-production/artifact-store'
import { assertProductBuildTerminalReadSetUnchangedV1 } from '../product-production/artifact-store'

const TYPE = 'authorize-text-open-world-creator-budget-recovery' as const
const VALIDATION_TASKS = new Set(['v1.deterministic-preflight', 'v2.balance-review', 'v2.semantic-review', 'v3.runtime-package', 'qa.release'])
export const CREATOR_BUDGET_REUSE_IMPACT = ['production-budget']
function fail(message: string): never { throw new Error(`[text-open-world-budget-recovery] ${message}`) }

export interface TextOpenWorldBudgetRecoveryAuthorizationV1 {
  schema: 'storyforge.text-open-world-budget-recovery-authorization'
  version: 1
  productionKey: string
  expectedStateRevision: number
  baseBuildNumber: number
  baseBuildStateRevision: number
  baseControlEpoch: number
  briefHash: string
  basePlanHash: string
  prefixHash: string
  targetBuildNumber: number
  targetControlEpoch: number
  targetPlanHash: string
  reuseTaskKeys: string[]
  authorizationNonce: string
  authorizedAt: number
  authorizationHash: string
}

export interface TextOpenWorldBudgetRecoveryPreparationV1 {
  scope: WorkspaceScope
  source: TextOpenWorldCreatorDerivedBuildAuthorityV1
  prefix: VerifiedProductBuildTerminalArtifactSetV1 & { prefixHash: string; completedTaskKeys: string[] }
  targetPlan: ProductProductionPlanV3
  targetPlanHash: string
  reuseTaskKeys: string[]
  commandRowsJson: string
}

async function recoveryPlan(input: {
  sourcePlan: ProductProductionPlanV3
  sourceBuild: ProductBuildRecordV1
  targetBuildNumber: number
  targetControlEpoch: number
  completedTaskKeys: string[]
  artifacts: ProductBuildArtifactRecordV1[]
}): Promise<ProductProductionPlanV3> {
  const completed = new Set(input.completedTaskKeys)
  const reused = new Set<string>()
  const artifacts = new Map(input.artifacts.map(row => [row.artifactKey, row]))
  const tasks: ProductProductionPlanV3['tasks'] = []
  for (const sourceTask of input.sourcePlan.tasks) {
    const task = { ...sourceTask, reuse: null,
      requiredReceipts: sourceTask.requiredReceipts.map(row => ({ ...row, receiptHash: null })) }
    if (!completed.has(task.taskKey) || VALIDATION_TASKS.has(task.taskKey)
      || task.dependsOn.some(key => !reused.has(key))) {
      tasks.push(task)
      continue
    }
    const rows = task.outputArtifactKeys.map(key => artifacts.get(key) ?? fail(`完整任务输出缺失:${key}`))
    const reuseKey = await hash({
      schema: 'storyforge.product-production-cross-build-reuse', version: 1,
      sourceBuildNumber: input.sourceBuild.buildNumber, targetBuildNumber: input.targetBuildNumber,
      taskKey: task.taskKey, userImpact: CREATOR_BUDGET_REUSE_IMPACT,
      artifacts: rows.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash })),
    })
    tasks.push({ ...task, reuse: {
      sourceBuildNumber: input.sourceBuild.buildNumber, sourceArtifactKey: rows[0].artifactKey,
      sourceContentHash: rows[0].contentHash, reuseKey, requiresRevalidation: true,
      reason: '作者授权预算续建；保留原 Build 用量与未知占用，仅复用已验签的完整任务前缀',
    } })
    reused.add(task.taskKey)
  }
  return parseProductProductionPlanV3({ ...input.sourcePlan, tasks,
    buildNumber: input.targetBuildNumber, controlEpoch: input.targetControlEpoch })
}

export async function prepareTextOpenWorldBudgetRecoveryV1(input: {
  scope: WorkspaceScope; productionId: number; buildId: number
}): Promise<TextOpenWorldBudgetRecoveryPreparationV1> {
  const scope = await resolveScope({ scope: input.scope })
  const { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } = await import('./creator-derived-authority')
  const source = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({ scope, buildId: input.buildId })
  if (source.production.id !== input.productionId || source.production.status !== 'producing'
    || source.production.currentBuildNumber !== source.build.buildNumber
    || source.production.currentBriefRevision !== source.build.briefRevision
    || source.production.controlEpoch !== source.build.controlEpoch
    || source.commandChain.length >= 128) fail('只能从当前已停止的预算失败 Build 续建')
  const { verifyTextOpenWorldBudgetRecoveryPrefixV1 } = await import('../product-production/artifact-store')
  const prefix = await verifyTextOpenWorldBudgetRecoveryPrefixV1({ scope,
    productionId: input.productionId, buildId: input.buildId,
    expectedControlEpoch: source.build.controlEpoch, expectedPlanHash: source.build.planHash })
  const targetPlan = await recoveryPlan({
    sourcePlan: source.productionPlan, sourceBuild: source.build,
    targetBuildNumber: source.build.buildNumber + 1, targetControlEpoch: source.production.controlEpoch,
    completedTaskKeys: prefix.completedTaskKeys, artifacts: prefix.artifacts,
  })
  return { scope, source, prefix, targetPlan, targetPlanHash: await hash(targetPlan),
    reuseTaskKeys: targetPlan.tasks.filter(task => task.reuse !== null).map(task => task.taskKey),
    commandRowsJson: json(source.commandChain),
  }
}

export async function createTextOpenWorldBudgetRecoveryAuthorizationV1(input: {
  prepared: TextOpenWorldBudgetRecoveryPreparationV1
  expectedStateRevision: number; authorizationNonce: string; authorizedAt: number
}): Promise<TextOpenWorldBudgetRecoveryAuthorizationV1> {
  const { source, prefix, targetPlan, targetPlanHash, reuseTaskKeys } = input.prepared
  if (input.expectedStateRevision !== source.production.stateRevision) fail('续建预览已过期')
  const body: Omit<TextOpenWorldBudgetRecoveryAuthorizationV1, 'authorizationHash'> = {
    schema: 'storyforge.text-open-world-budget-recovery-authorization', version: 1,
    productionKey: source.production.productionKey, expectedStateRevision: input.expectedStateRevision,
    baseBuildNumber: source.build.buildNumber, baseBuildStateRevision: source.build.stateRevision,
    baseControlEpoch: source.build.controlEpoch, briefHash: source.build.briefHash,
    basePlanHash: source.build.planHash, prefixHash: prefix.prefixHash,
    targetBuildNumber: targetPlan.buildNumber, targetControlEpoch: targetPlan.controlEpoch,
    targetPlanHash, reuseTaskKeys, authorizationNonce: input.authorizationNonce, authorizedAt: input.authorizedAt,
  }
  return { ...body, authorizationHash: await hash(body) }
}

export async function assertTextOpenWorldBudgetRecoveryPreparationCurrentV1(prepared: TextOpenWorldBudgetRecoveryPreparationV1): Promise<void> {
  // This runs inside the command's native IDB transaction: no dynamic import,
  // WebCrypto or other non-IDB await may split the atomic read/write boundary.
  await assertProductBuildTerminalReadSetUnchangedV1({ readSet: prepared.prefix.casReadSet })
  const commands = await db.productProductionCommands.bulkGet(prepared.source.commandChain.map(row => row.id))
  if (json(commands) !== prepared.commandRowsJson) fail('父级作者授权链已变化')
}

export interface TextOpenWorldBudgetRecoveryAuthorityV1 {
  source: TextOpenWorldCreatorDerivedBuildAuthorityV1
  targetBuild: ProductBuildRecordV1 & { id: number }
  targetPlan: ProductProductionPlanV3
  authorizedPlan: ProductProductionPlanV3
  authorization: TextOpenWorldBudgetRecoveryAuthorizationV1
  command: ProductProductionCommandRecordV1 & { id: number }
}

/** Command identity and frozen DAG authority; actual parent bytes/Run/blob
 * proofs are rechecked by artifact-store at carry and terminal verification. */
export async function readTextOpenWorldBudgetRecoveryAuthorityV1(input: {
  scope: WorkspaceScope; buildId: number
}): Promise<TextOpenWorldBudgetRecoveryAuthorityV1> {
  const scope = await resolveScope({ scope: input.scope })
  const target = await db.productBuilds.get(input.buildId)
  if (!target?.id || target.parentBuildNumber == null
    || !await assertRecordInScope(scope, 'productBuilds', target, { owner: 'work' })) fail('缺少续建目标')
  const sourceRow = await db.productBuilds.where('[productionId+buildNumber]')
    .equals([target.productionId, target.parentBuildNumber]).first()
  if (!sourceRow?.id || target.buildNumber !== sourceRow.buildNumber + 1) fail('续建只能指向直接父 Build')
  const rows = await db.productProductionCommands.where('[productionId+status]')
    .equals([target.productionId, 'succeeded']).filter(row => row.type === TYPE).limit(129).toArray()
  if (rows.length > 128) fail('续建历史超过安全上限')
  const matches: Array<{ command: ProductProductionCommandRecordV1 & { id: number }; authorization: TextOpenWorldBudgetRecoveryAuthorizationV1 }> = []
  for (const row of rows) {
    if (!row.id || row.errorCode !== null || row.completedAt == null
      || !await assertRecordInScope(scope, 'productProductionCommands', row, { owner: 'work' })) continue
    try {
      const auth = JSON.parse(row.resultJson) as TextOpenWorldBudgetRecoveryAuthorizationV1
      const { authorizationHash, ...body } = auth
      if (auth.schema !== 'storyforge.text-open-world-budget-recovery-authorization' || auth.version !== 1
        || auth.targetBuildNumber !== target.buildNumber || !isSha256Hash(auth.targetPlanHash)
        || !isSha256Hash(auth.prefixHash) || await hash(body) !== authorizationHash) continue
      const { parseProductProductionCommandV1 } = await import('../product-production/contracts')
      const command = parseProductProductionCommandV1({
        type: TYPE, commandId: row.commandId, expectedStateRevision: auth.expectedStateRevision,
        baseBuildNumber: auth.baseBuildNumber, expectedBasePlanHash: auth.basePlanHash,
        expectedPrefixHash: auth.prefixHash, expectedTargetPlanHash: auth.targetPlanHash,
        authorizationNonce: auth.authorizationNonce, authorizedAt: auth.authorizedAt,
      })
      if (row.expectedStateRevision !== auth.expectedStateRevision || row.payloadHash !== await hash(command)) continue
      matches.push({ command: row as ProductProductionCommandRecordV1 & { id: number }, authorization: auth })
    } catch { /* A malformed receipt grants no authority. */ }
  }
  if (matches.length !== 1) fail('续建缺少唯一成功命令')
  const { authorization, command } = matches[0]
  const { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } = await import('./creator-derived-authority')
  const source = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({ scope, buildId: sourceRow.id })
  if (source.commandChain.length >= 128 || source.production.productionKey !== authorization.productionKey
    || source.build.status !== 'recovery-required'
    || source.build.stateRevision !== authorization.baseBuildStateRevision
    || source.build.controlEpoch !== authorization.baseControlEpoch
    || source.build.briefHash !== authorization.briefHash || source.build.planHash !== authorization.basePlanHash
    || source.build.buildNumber !== authorization.baseBuildNumber
    || target.briefHash !== source.build.briefHash || target.briefRevision !== source.build.briefRevision
    || target.controlEpoch < authorization.targetControlEpoch || target.authorizedAt !== authorization.authorizedAt) {
    fail('续建命令与父子 Build 已偏离')
  }
  const ledger = JSON.parse(source.build.budgetLedgerJson) as { tasks: Record<string, { status: string }> }
  const completedTaskKeys = source.productionPlan.tasks.filter(task => ledger.tasks[task.taskKey]?.status === 'settled').map(task => task.taskKey)
  const artifacts = (await db.productBuildArtifacts.where('buildId').equals(source.build.id).toArray())
    .filter(row => row.controlEpoch === source.build.controlEpoch && ['accepted', 'carried-forward'].includes(row.status))
  // A formal pause/retry advances Build.controlEpoch before the scheduler atomically
  // rebinds the frozen Plan and carried outputs. Read the unchanged older Plan for
  // that recovery only; production-authority still requires exact current epoch.
  const storedPlan = parseProductProductionPlanV3(target.planJson)
  if (storedPlan.controlEpoch < authorization.targetControlEpoch
    || storedPlan.controlEpoch > target.controlEpoch) fail('续建 Plan 轮次越界')
  const authorizedPlan = await recoveryPlan({ sourcePlan: source.productionPlan, sourceBuild: source.build,
    targetBuildNumber: target.buildNumber, targetControlEpoch: authorization.targetControlEpoch, completedTaskKeys, artifacts })
  const targetPlan = storedPlan.controlEpoch === authorization.targetControlEpoch ? authorizedPlan
    : parseProductProductionPlanV3({ ...authorizedPlan, controlEpoch: storedPlan.controlEpoch,
      tasks: authorizedPlan.tasks.map(task => ({ ...task, reuse: null })) })
  if (await hash(authorizedPlan) !== authorization.targetPlanHash) fail('续建原始 Plan 已偏离授权')
  if (json(targetPlan) !== target.planJson || await hash(targetPlan) !== target.planHash
    || json(authorizedPlan.tasks.filter(task => task.reuse !== null).map(task => task.taskKey)) !== json(authorization.reuseTaskKeys)) {
    fail('续建改变了冻结任务、预算、能力、验收门或完整复用集')
  }
  return { source, targetBuild: target as ProductBuildRecordV1 & { id: number }, targetPlan, authorizedPlan, authorization, command }
}
