import { continueTtrpgOpenFactLedger, createTtrpgOpenFactBasisV1 } from './open-fact-ledger'
import { assertTtrpgOpenReleaseCompatibilityV1 } from './open-release-compatibility'
import { verifyTtrpgOpenReleaseContinuationRuntimeV1 } from './open-release-continuation-proof'
/** Compatible release-bound migration through the existing instance factory. */
import type { ProductRuntimeEvent, ProductRuntimeSession, ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { prepareTtrpgOpenBranchStateV1 } from './open-branch'
import { assertTtrpgOpenPressureGmV1 } from './open-pressure-cycle'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { projectTtrpgOpenSelectedSituationsV1, evaluateTtrpgOpenNextStageOpeningV1 } from './open-stage-opening-plan'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { parseTtrpgOpenReleaseContinuationPlanV1, verifyTtrpgOpenReleaseContinuationPlanV1, type TtrpgOpenReleaseContinuationPlanV1 } from './open-release-continuation-contract'
import * as p from './open-contract-parse'

export interface TtrpgOpenContinuationRequestV1 {
  kind: 'open-compatible'; compatibility: 'compatible'
  parentSessionId: number; expectedParentSequence: number; expectedParentStateHash: string; expectedPlanHash: string
  transitionKey: string; approvedBy: string; reason: string; openingTemplateKeys: string[]
}
export function isTtrpgOpenContinuationRequestV1(value: unknown): value is TtrpgOpenContinuationRequestV1 {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'open-compatible'
}
const prepared = new WeakMap<ProductRuntimeState, { hash: string; targetSourceHash: string }>()

export { assertTtrpgOpenReleaseCompatibilityV1 } from './open-release-compatibility'

export async function buildTtrpgOpenReleaseContinuationV1(input: {
  parent: ProductRuntimeSession; parentState: ProductRuntimeState; parentStateHash: string; events: readonly ProductRuntimeEvent[]
  parentContent: TtrpgRuntimeContentV2; targetContent: TtrpgRuntimeContentV2; targetRuntimeSourceHash: string; targetInitialState: ProductRuntimeState
  transitionKey: string; approvedBy: string; reason: string; openingTemplateKeys: readonly string[]
}): Promise<{ state: ProductRuntimeState; plan: TtrpgOpenReleaseContinuationPlanV1 }> {
  const runtime = parseTtrpgRuntimeStateV2(input.parentState.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth || !runtime.product.sessionZero.completed || runtime.product.safety.status !== 'active'
    || input.parent.kind !== 'ttrpg' || !input.parent.runtimeSourceHash || input.parent.productReleaseId == null) p.fail('续团需要当前已开始的正式发布存档')
  const approvedBy = p.key(input.approvedBy, 'current continuation approver'); assertTtrpgOpenPressureGmV1(auth, approvedBy)
  if (run.coordination.epochs.some(e => e.status === 'active' && e.hostingDelegation && !e.hostingDelegation.stoppedRef)
    || run.coordination.calls.some(c => c.status === 'prepared' || c.status === 'dispatched')) p.fail('请先核对并明确结束当前授权窗口；续团不会停止或重发请求')
  for (const operation of run.operations.filter(o => ['awaiting-approval', 'executing'].includes(o.status))) {
    const next = nextTtrpgOpenOperationStepV1(operation)
    if (operation.status !== 'executing' || !next || !['gates', 'narration', 'handoff'].includes(next.kind)
      || operation.businessRefs.length !== operation.receipts.length) p.fail('请先完成或恢复原机械结算；续团不能丢弃未提交后果')
  }
  if (run.entityOperations?.some(o => o.resolution === null)) p.fail('请先明确处理当前对象计划')
  assertTtrpgOpenReleaseCompatibilityV1(input.parentContent, input.targetContent)
  if (run.worldTime.worldTurn >= input.targetContent.campaign.stageClosurePolicy.maximumWorldTurns) p.fail('原世界轮次已达到目标发布的单局上限')
  const targetRuntimeSourceHash = p.hash(input.targetRuntimeSourceHash, 'continued target source')
  const parentStateHash = p.hash(input.parentStateHash, 'continued parent state')
  const openingTemplateKeys = p.keys(input.openingTemplateKeys, 'continued opening', 20, 1)
  const transitionKey = p.key(input.transitionKey, 'continuation transition'), reason = p.text(input.reason, 'explicit continuation reason', 2000)
  const openingKey = await hash({ parentSessionKey: runtime.sessionKey, parentSequence: input.parentState.lastSequence,
    parentStateHash, targetRuntimeSourceHash, transitionKey, approvedBy, reason, openingTemplateKeys })
  const childSessionKey = `ttrpg.continued.${openingKey}`, targetContentHash = await hash(input.targetContent)
  // Prospective validation uses actual parent seats. The child must repeat it with its newly claimed seats at Session Zero.
  const projected = projectTtrpgOpenSelectedSituationsV1({ state: input.parentState, content: input.targetContent,
    runtimeSourceHash: targetRuntimeSourceHash, viewerKey: approvedBy, commandId: transitionKey,
    templateKeys: openingTemplateKeys, openingKey, frozenContentHash: targetContentHash })
  evaluateTtrpgOpenNextStageOpeningV1(projected.proposedState, input.targetContent, `stage.opening.${openingKey}`, await hash(projected.proposedState))
  const state = await prepareTtrpgOpenBranchStateV1({ parent: input.parent, state: input.parentState,
    events: input.events, throughSequence: input.parentState.lastSequence, childSessionKey })
  const child = parseTtrpgRuntimeStateV2(state.ttrpg)!, childRun = child.openRun!
  const interrupted: TtrpgOpenReleaseContinuationPlanV1['interrupted'] = []
  for (const task of child.branchLineage!.recoveryTasks) {
    if (!['awaiting-authorization', 'ready'].includes(task.status)) continue
    if (!task.remainingStepKeys.length || task.remainingStepKeys.some(k => !['gates', 'narration', 'handoff'].includes(k))) p.fail('祖先仍有机械待办，必须先恢复原结算')
    interrupted.push({ taskKey: task.taskKey, ancestorSessionKey: task.ancestorSessionKey, operationKey: task.operation.operationKey,
      operationHash: await hash(task.operation), remainingStepKeys: [...task.remainingStepKeys] })
    task.status = 'withdrawn'
  }
  const unknownCalls: TtrpgOpenReleaseContinuationPlanV1['unknownCalls'] = []
  for (const ancestor of child.branchLineage!.ancestors) for (const call of ancestor.snapshot.openRun?.coordination.calls ?? []) {
    if (call.status === 'unknown' && !unknownCalls.some(c => c.sessionKey === ancestor.sessionKey && c.requestKey === call.requestKey)) {
      unknownCalls.push({ sessionKey: ancestor.sessionKey, requestKey: call.requestKey, recordHash: await hash(call) })
    }
  }
  // An earlier continuation is retained in the frozen ancestor, never rewritten into this new receipt.
  delete childRun.releaseContinuation
  if (childRun.factLedger) childRun.factLedger = continueTtrpgOpenFactLedger(childRun.factLedger, await createTtrpgOpenFactBasisV1(input.targetContent, targetRuntimeSourceHash))
  state.ttrpg = child; state.narrative = structuredClone(input.targetInitialState.narrative)
  const body = { schema: 'storyforge.ttrpg-open-release-continuation' as const, version: 1 as const, transitionKey, approvedBy, reason,
    parentSessionKey: runtime.sessionKey, parentSequence: input.parentState.lastSequence, parentStateHash,
    parentRuntimeSourceHash: input.parent.runtimeSourceHash, targetRuntimeSourceHash,
    parentContentHash: await hash(input.parentContent), targetContentHash, childSessionKey, seedCommitment: await sha256Text(input.parent.seed),
    worldTurn: run.worldTime.worldTurn, selectedActorKeys: [...auth.selectedActorKeys], openingTemplateKeys,
    interrupted, unknownCalls, migratedStateHash: await hash(state) }
  const plan = parseTtrpgOpenReleaseContinuationPlanV1({ ...body, planHash: await hash(body) })
  childRun.releaseContinuation = { plan, confirmedRef: null }; state.ttrpg = child
  parseTtrpgRuntimeStateV2(state.ttrpg)
  prepared.set(state, { hash: await hash(state), targetSourceHash: targetRuntimeSourceHash })
  return { state, plan }
}

export async function consumePreparedTtrpgOpenContinuationV1(state: ProductRuntimeState, runtimeSourceHash: string): Promise<void> {
  const witness = prepared.get(state), runtime = parseTtrpgRuntimeStateV2(state.ttrpg), receipt = runtime?.openRun?.releaseContinuation
  if (!witness || witness.targetSourceHash !== runtimeSourceHash || witness.hash !== await hash(state) || !receipt
    || receipt.plan.targetRuntimeSourceHash !== runtimeSourceHash || receipt.plan.childSessionKey !== runtime!.sessionKey
    || !prepared.delete(state)) p.fail('续团状态必须来自当前已验证且未改写的唯一准备')
  await verifyTtrpgOpenReleaseContinuationPlanV1(receipt.plan)
  await verifyTtrpgOpenReleaseContinuationRuntimeV1({ runtime: runtime!, runtimeSourceHash, initialState: state })
}
