import { productProductionTaskExecutionIdentityHashV1, type ProductProductionTaskExecutionInputV1 } from '../product-production/scheduler'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readAgentRunV1 } from '../agent/run/event-store'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'

/** Mirrors the shared scheduler's task runtime identity, with exactly its
 * normalized, non-secret binding list. Read-only; creates no claim. */
export async function hashAvgTaskRuntimeBindingV1(input: Pick<ProductProductionTaskExecutionInputV1, 'planHash' | 'task' | 'capabilityBindings'>) {
  return hashProductProductionValueV2({ schema: 'storyforge.product-production-task-runtime', version: 1,
    executor: 'product-production-scheduler', planHash: input.planHash, taskKey: input.task.taskKey, taskKind: input.task.kind,
    executionMode: input.task.executionMode, skillId: input.task.skillId ?? null,
    executionIdentityHash: await productProductionTaskExecutionIdentityHashV1(input.task),
    capabilityBindingHash: input.capabilityBindings.length ? await hashProductProductionValueV2(input.capabilityBindings) : null })
}

/** Shared within AVG: an actual root/child claim and frozen Skill write domain,
 * not authority inferred from an executor argument or an arbitrary Run id. */
export async function assertAvgTaskHarnessClaimV1(input: ProductProductionTaskExecutionInputV1, budgetLedgerJson: string, expectedSkillId: string | null = input.task.skillId) {
  if (!input.taskRunId) throw new Error('[avg-task] 生产任务调用缺少实际 durable 子 Run')
  let parsed: unknown
  try { parsed = JSON.parse(budgetLedgerJson) } catch { throw new Error('[avg-task] 生产任务预算 ledger 损坏') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('[avg-task] 生产任务预算 ledger 无效')
  const ledger = parsed as { schema?: string; version?: number; rootRunId?: number;
    tasks?: Record<string, { runId?: number; attempt?: number; status?: string; idempotencyKey?: string }> }
  const claim = ledger.tasks?.[input.task.taskKey]
  if (ledger.schema !== 'storyforge.product-production-budget-ledger' || ledger.version !== 2
    || !Number.isSafeInteger(ledger.rootRunId) || ledger.rootRunId! < 1 || claim?.runId !== input.taskRunId
    || claim.attempt !== input.attempt || claim.status !== 'claimed' || claim.idempotencyKey !== input.idempotencyKey) {
    throw new Error('[avg-task] 生产任务子 Run 没有当前预算 ledger 的准确领取')
  }
  const child = await readAgentRunV1(input.scope, input.taskRunId), root = await readAgentRunV1(input.scope, ledger.rootRunId!)
  const boundary = child.contract.scope.productProduction, rootBoundary = root.contract.scope.productProduction
  const skill = expectedSkillId ? getAgentSkillV1(expectedSkillId) : null
  const expectedBindings = skill ? [{ stepId: input.task.taskKey, ...createAgentSkillExecutionBindingV1(skill) }] : []
  const writes = skill ? skill.writeTargets.map(target => ({ table: target.table, fields: [...target.fields], mode: 'candidate-only',
    ...(target.adoptionExtension ? { adoptionExtension: target.adoptionExtension } : {}) }))
    : [{ table: 'productBuildArtifacts', fields: [], mode: 'candidate-only', adoptionExtension: 'product-production-artifacts' }]
  if (child.run.productBuildId !== input.buildId || child.projection.state !== 'running'
    || child.run.parentRunId !== root.run.id || child.run.parentRelation !== `task:${input.task.taskKey}`
    || boundary?.productBuildId !== input.buildId || boundary.buildNumber !== input.buildNumber
    || boundary.controlEpoch !== input.controlEpoch || boundary.planHash !== input.planHash || boundary.taskKey !== input.task.taskKey
    || child.projection.steps[input.task.taskKey]?.status !== 'running' || child.projection.steps[input.task.taskKey]?.attempt !== input.attempt
    || canonicalProductProductionJsonV2(child.contract.executionBindings ?? []) !== canonicalProductProductionJsonV2(expectedBindings)
    || canonicalProductProductionJsonV2(child.contract.permissions.writeTargets) !== canonicalProductProductionJsonV2(writes)
    || root.run.productBuildId !== input.buildId || root.run.parentRunId != null || root.projection.state !== 'running'
    || rootBoundary?.productBuildId !== input.buildId || rootBoundary.buildNumber !== input.buildNumber
    || rootBoundary.controlEpoch !== input.controlEpoch || rootBoundary.planHash !== input.planHash || rootBoundary.taskKey !== '$root') {
    throw new Error('[avg-task] 实际 root/子 Run、Skill 快照或候选写域与当前任务不一致')
  }
  return { child, root }
}
