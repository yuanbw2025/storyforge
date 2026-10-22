/** Replay/lineage proof. Confirmed instances survive branches; pending permission never does. */
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { isTtrpgOpenPassiveEpochV1 } from './open-coordination'
import { ttrpgOpenAncestorSourceAllowedV1 } from './open-branch-contract'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'
import { assertTtrpgOpenEntityModelPlanCallV1 } from './open-entity-model-origin-contract'

export function assertTtrpgOpenEntityJournalV1(runtime: TtrpgRuntimeStateV2) {
  const run = runtime.openRun
  if (!run?.entityOperations) return
  p.unique(run.entityOperations.map(row => row.plan.operationKey), 'entity operation identities')
  p.unique(run.entityOperations.flatMap(row => row.plan.items.map(item => item.entityKey)), 'entity reserved identities')
  const pending = run.entityOperations.filter(row => !row.resolution)
  if (pending.length > 1 || pending.length && run.operations.some(row => ['executing', 'awaiting-approval'].includes(row.status))) p.fail('实体与规则行动不能同时占用结算窗口')
  for (const operation of run.entityOperations) {
    const { plan, resolution } = operation, current = plan.proposedRef.sessionKey === runtime.sessionKey
    const source = current ? runtime : runtime.branchLineage?.ancestors.find(row => row.sessionKey === plan.proposedRef.sessionKey)?.snapshot
    const auth = source?.authorization, origin = source?.openRun
    const epoch = origin?.coordination.epochs.find(row => row.epochKey === plan.authorizationEpochKey)
    const oracle = origin?.oracleReceipts?.find(row => stable(row.sourceRef) === stable(plan.oracleSourceRef))
    if (!auth || !origin || !epoch || !oracle || epoch.viewerKey !== plan.viewerKey || epoch.authorizationHash !== plan.authorizationHash
      || isTtrpgOpenPassiveEpochV1(epoch) || oracle.viewerKey !== plan.viewerKey || oracle.authorizationEpochKey !== epoch.epochKey
      || plan.proposedRef.sequence <= oracle.sourceRef.sequence || plan.proposedRef.sequence <= epoch.startedRef.sequence
      || epoch.closedRef && (plan.proposedRef.sequence >= epoch.closedRef.sequence || resolution && resolution.sourceRef.sequence >= epoch.closedRef.sequence)) p.fail('实体计划没有原始 Oracle 和活动窗口来源')
    const host = assertTtrpgOpenHumanHostV1(auth, plan.viewerKey)
    if (plan.version === 2) assertTtrpgOpenEntityModelPlanCallV1(plan, origin)
    if (host.seatKey !== plan.seatKey || !plan.requiredApprovals.some(row => row.actorKey === (host.actorKey ?? 'gm') && row.allowedSeatKeys.includes(host.seatKey))) p.fail('实体计划缺少原真人主持的明确确认要求')
    for (const approval of operation.approvals) {
      const seat = auth.seats.find(row => row.viewerKey === approval.viewerKey)
      if (!seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || seat.seatKey !== approval.approverSeatKey
        || !plan.requiredApprovals.some(row => row.actorKey === approval.actorKey && row.allowedSeatKeys.includes(seat.seatKey))) p.fail('实体确认没有真实原真人席位来源')
    }
    if (current && !resolution && (epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey)) p.fail('未处置实体计划不能离开原授权窗口')
    if (!current && (resolution?.kind !== 'materialized'
      || !ttrpgOpenAncestorSourceAllowedV1(runtime.branchLineage, resolution.sourceRef, ['ttrpg.open.entity.materialized'])
      || !origin.entityOperations?.some(row => stable(row) === stable(operation)))) p.fail('分支只能继承切点前实际创建的实体，不继承待确认权限')
  }
}
