import type { ProductRuntimeState } from '../types'
import { parseTtrpgRuntimeStateV2, type TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { verifyTtrpgOpenReleaseContinuationPlanV1 } from './open-release-continuation-contract'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'

/** A retained suffix is interrupted, not completed or newly authorized. */
export function ttrpgOpenContinuationTaskInterruptedV1(runtime: TtrpgRuntimeStateV2, taskKey: string): boolean {
  const receipt = runtime.openRun?.releaseContinuation
  const task = runtime.branchLineage?.recoveryTasks.find(t => t.taskKey === taskKey)
  return !!receipt && !!task && task.status === 'withdrawn' && receipt.plan.interrupted.some(t => t.taskKey === taskKey
    && t.ancestorSessionKey === task.ancestorSessionKey && t.operationKey === task.operation.operationKey
    && stable(t.remainingStepKeys) === stable(task.remainingStepKeys))
}
export async function verifyTtrpgOpenReleaseContinuationRuntimeV1(input: {
  runtime: TtrpgRuntimeStateV2; runtimeSourceHash: string; seed?: string; initialState?: ProductRuntimeState
}): Promise<void> {
  const { runtime } = input, receipt = runtime.openRun?.releaseContinuation
  if (!receipt) return
  const { plan } = receipt, ancestors = runtime.branchLineage?.ancestors ?? []
  await verifyTtrpgOpenReleaseContinuationPlanV1(plan)
  const parent = ancestors.find(a => a.sessionKey === plan.parentSessionKey)
  if (!parent || parent.throughSequence !== plan.parentSequence || parent.stateHash !== plan.parentStateHash
    || parent.runtimeSourceHash !== plan.parentRuntimeSourceHash || parent.randomSource.seedCommitment !== plan.seedCommitment
    || parent.snapshot.openRun?.worldTime.worldTurn !== plan.worldTurn) p.fail('续团缺少原真实切点、时间或随机依据')
  if (plan.targetRuntimeSourceHash !== input.runtimeSourceHash) p.fail('续团没有绑定当前冻结发布')
  if (plan.childSessionKey !== runtime.sessionKey) {
    const owner = ancestors.find(a => a.sessionKey === plan.childSessionKey)
    if (!owner || stable(owner.snapshot.openRun?.releaseContinuation) !== stable(receipt)) p.fail('分支续团回执不能改写原封存记录')
  } else {
    if (input.seed !== undefined && await sha256Text(input.seed) !== plan.seedCommitment) p.fail('续团不能替换原随机种子')
    for (const item of plan.interrupted) {
      const task = runtime.branchLineage?.recoveryTasks.find(t => t.taskKey === item.taskKey)
      if (!task || !ttrpgOpenContinuationTaskInterruptedV1(runtime, item.taskKey)) p.fail('续团中断事项不匹配真实祖先待办')
    }
    if (input.initialState) {
      const state = structuredClone(input.initialState)
      const initialRuntime = parseTtrpgRuntimeStateV2(state.ttrpg)
      if (!initialRuntime?.openRun) p.fail('续团初态缺失')
      state.ttrpg = initialRuntime
      const initial = initialRuntime.openRun.releaseContinuation
      if (!initial || initial.confirmedRef !== null || stable(initial.plan) !== stable(plan)) p.fail('续团初态不得携带开局权限')
      delete initialRuntime.openRun.releaseContinuation
      if (await hash(state) !== plan.migratedStateHash) p.fail('续团初态与明确确认的迁移结果不一致')
    }
  }
  for (const item of plan.interrupted) {
    const original = ancestors.find(a => a.sessionKey === item.ancestorSessionKey)?.snapshot.openRun?.operations.find(o => o.operationKey === item.operationKey)
    if (!original || await hash(original) !== item.operationHash
      || stable(original.plannedSteps.slice(original.businessRefs.length).map(s => s.stepKey)) !== stable(item.remainingStepKeys)) p.fail('中断不能改写原行动或伪造剩余步骤')
  }
  for (const item of plan.unknownCalls) {
    const original = ancestors.find(a => a.sessionKey === item.sessionKey)?.snapshot.openRun?.coordination.calls.find(c => c.requestKey === item.requestKey)
    if (!original || original.status !== 'unknown' || await hash(original) !== item.recordHash) p.fail('费用或结果未知的原请求不得丢失或改写')
  }
}

/** Current source or a real frozen ancestor; no new read/adopt/execute permission. */
export function ttrpgOpenFrozenSourceHashV1(runtime: TtrpgRuntimeStateV2, ref: { sessionKey: string; sequence: number }, currentSourceHash: string): string {
  if (ref.sessionKey === runtime.sessionKey) return currentSourceHash;
  const ancestor = runtime.branchLineage?.ancestors.find(a => a.sessionKey === ref.sessionKey && a.throughSequence >= ref.sequence);
  if (!ancestor || ancestor.runtimeSourceHash !== currentSourceHash && !runtime.openRun?.releaseContinuation) p.fail('冻结来源不属于当前团局或已保留的续团祖先');
  return ancestor.runtimeSourceHash;
}
