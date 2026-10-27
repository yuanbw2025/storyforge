/** Local inheritance receipts refer to frozen parent business; they never impersonate a child roll. */
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import * as p from './open-contract-parse'
export function applyTtrpgOpenBranchEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type !== 'ttrpg.open.source.inherited') return false
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.branchLineage || !runtime.authorization || !runtime.openRun) p.fail('来源继承需要子分支的新真人授权')
  const body = p.record(payload, ['taskKey', 'ancestorSessionKey', 'ancestorEvidenceHash', 'sourceRefs', 'viewerKey', 'epochKey', 'intent'], 'source inherited')
  const task = runtime.branchLineage.recoveryTasks.find(task => task.taskKey === body.taskKey)
  const ancestor = runtime.branchLineage.ancestors.find(ancestor => ancestor.sessionKey === body.ancestorSessionKey)
  const epoch = runtime.openRun.coordination.epochs.find(epoch => epoch.epochKey === body.epochKey)
  const seat = runtime.authorization.seats.find(seat => seat.viewerKey === body.viewerKey)
  if (!task || !ancestor || task.status !== 'awaiting-authorization' || task.ancestorSessionKey !== ancestor.sessionKey
    || body.ancestorEvidenceHash !== ancestor.evidenceHash || !epoch || epoch.status !== 'active'
    || runtime.openRun.coordination.activeEpochKey !== epoch.epochKey || epoch.viewerKey !== body.viewerKey
    || !seat || seat.assignmentState !== 'claimed' || seat.controller === 'ai' || event.actorKey !== seat.actorKey
    || stable(body.sourceRefs) !== stable(task.operation.businessRefs.map(business => business.sourceRef))) p.fail('继承回执必须精确引用父已提交业务和当前真人窗口')
  task.inheritedRef = { sessionKey: runtime.sessionKey, sequence: event.sequence }
  task.status = 'ready'
  state.ttrpg = runtime
  return true
}
