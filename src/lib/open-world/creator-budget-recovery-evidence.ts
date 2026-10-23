import { readAgentRunV1 } from '../agent/run/event-store'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type { ProductBuildRecordV1, ProductProductionPlanV3, WorkspaceScope } from '../types'
import { isTextOpenWorldBudgetRecoveryFailureV1 } from './creator-budget-recovery-policy'

function fail(message: string): never {
  throw new Error(`[text-open-world-budget-recovery] ${message}`)
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('预算证据不是对象')
  return value as Record<string, unknown>
}

/** A stopped root is not a completed Build. Only its independently completed,
 * dependency-closed prefix may be considered for an explicitly authorized child. */
export async function readTextOpenWorldBudgetFailureV1(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1 & { id: number }
  plan: ProductProductionPlanV3
}): Promise<{
  completedTaskKeys: string[]
  completedLedgerJson: string
  portableBudget: unknown
}> {
  const { build, plan } = input
  const { assertProductProductionBudgetLedgerV1 } = await import('../product-production/scheduler')
  assertProductProductionBudgetLedgerV1(build.budgetLedgerJson)
  const failure = object(JSON.parse(build.failureJson))
  const provenance = object(failure.failureProvenance)
  const ledger = object(JSON.parse(build.budgetLedgerJson))
  const tasks = object(ledger.tasks)
  const taskKey = String(failure.taskKey)
  const failed = object(tasks[taskKey])
  if (build.status !== 'recovery-required' || build.rootTerminalReceiptHash !== null
    || plan.productType !== 'text-open-world' || plan.controlEpoch !== build.controlEpoch
    || !isTextOpenWorldBudgetRecoveryFailureV1(build.failureJson)
    || provenance.planHash !== build.planHash || provenance.controlEpoch !== build.controlEpoch
    || provenance.rootRunId !== ledger.rootRunId || provenance.runId !== failed.runId
    || provenance.attempt !== failed.attempt || failure.attempt !== failed.attempt
    || failed.status !== 'failed' || failed.errorCode !== failure.code
    || failed.candidateHash !== null || failed.terminalReceiptHash !== null
    || ledger.rootClaim !== null || !Array.isArray(ledger.attempts)
    || !plan.tasks.some(task => task.taskKey === taskKey)) fail('缺少当前 Build 的派发前预算失败证据')
  const nonSettled = Object.entries(tasks).filter(([, row]) => object(row).status !== 'settled')
  if (nonSettled.length !== 1 || nonSettled[0][0] !== taskKey) fail('预算恢复不能包含在途或其他未裁决任务')
  const attempts = ledger.attempts.map(object)
  const currentAttempt = attempts.filter(row => row.runId === failed.runId && row.attempt === failed.attempt)
  if (currentAttempt.length !== 1 || currentAttempt[0].taskKey !== taskKey
    || currentAttempt[0].controlEpoch !== build.controlEpoch
    || currentAttempt[0].attempt !== failed.attempt
    || currentAttempt[0].outcome !== 'failed' || currentAttempt[0].usageKnown !== true
    || currentAttempt[0].errorCode !== failure.code
    || Object.values(object(currentAttempt[0].usage)).some(value => value !== 0)
    || canonicalProductProductionJsonV2(failed.usage) !== canonicalProductProductionJsonV2(currentAttempt[0].usage)) {
    fail('预算失败必须是唯一的零新增用量尝试')
  }
  const [root, child] = await Promise.all([
    readAgentRunV1(input.scope, Number(ledger.rootRunId)),
    readAgentRunV1(input.scope, Number(failed.runId)),
  ])
  for (const [snapshot, expectedTask] of [[root, '$root'], [child, taskKey]] as const) {
    const boundary = snapshot.contract.scope.productProduction
    if (snapshot.run.productBuildId !== build.id || boundary?.productBuildId !== build.id
      || boundary.buildNumber !== build.buildNumber || boundary.controlEpoch !== build.controlEpoch
      || boundary.planHash !== build.planHash || boundary.taskKey !== expectedTask
      || snapshot.run.projectId !== input.scope.projectId || snapshot.run.workId !== input.scope.workId) {
      fail('预算失败 Run 越界或已经过期')
    }
  }
  const starts = child.events.filter(event => event.type === 'step.started'
    && event.payload.stepId === taskKey && event.payload.attempt === failed.attempt)
  if (starts.length !== 1) fail('预算失败缺少唯一当前尝试边界')
  const startedSequence = starts[0].sequence
  if (!['failed', 'cancelled'].includes(root.run.status) || root.projection.state !== root.run.status
    || root.run.parentRunId !== null || root.run.parentRelation !== null
    || child.run.parentRunId !== root.run.id || child.run.parentRelation !== `task:${taskKey}`
    || child.run.status !== 'failed' || child.projection.state !== 'failed'
    || child.projection.steps[taskKey]?.attempt !== failed.attempt
    || child.projection.steps[taskKey]?.failureCode !== failure.code
    || !child.events.some(event => event.type === 'step.failed'
      && event.payload.code === failure.code && event.payload.stepId === taskKey
      && event.payload.attempt === failed.attempt && event.payload.retryable === false)
    // An earlier paid attempt in this same Run remains immutable history.
    // Only the current, independently settled zero-call attempt is a budget
    // refusal; a dispatch anywhere after its start makes it ineligible.
    || child.events.some(event => event.sequence > startedSequence
      && ['model.requested', 'model.responded', 'candidate.persisted'].includes(event.type))) {
    fail('预算失败事件不是已停止的派发前拒绝')
  }
  const completedTaskKeys = plan.tasks.filter(task => object(tasks[task.taskKey] ?? {}).status === 'settled')
    .map(task => task.taskKey)
  const completed = new Set(completedTaskKeys)
  if (!completed.size || completed.size >= plan.tasks.length
    || Object.keys(tasks).some(key => !plan.tasks.some(task => task.taskKey === key))
    || plan.tasks.some(task => completed.has(task.taskKey) && task.dependsOn.some(key => !completed.has(key)))) {
    fail('已完成任务不是冻结 Plan 的完整依赖前缀')
  }
  return {
    completedTaskKeys,
    completedLedgerJson: canonicalProductProductionJsonV2({
      ...ledger, tasks: Object.fromEntries(completedTaskKeys.map(key => [key, tasks[key]])),
    }),
    // Run IDs are local locators. Preserve every other attempt field, including
    // unknown holds and actual usage, in the portable recovery authorization.
    portableBudget: {
      attempts: attempts.map(({ runId: _runId, ...attempt }) => attempt),
      failure: { taskKey, attempt: failed.attempt, code: failure.code, detail: failure.detail,
        controlEpoch: build.controlEpoch, planHash: build.planHash },
    },
  }
}
