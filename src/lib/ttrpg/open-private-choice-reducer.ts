import type { ProductRuntimeEvent,ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenPrivateChoiceDisclosureV1 } from './open-private-choice-contract'
import { buildTtrpgOpenPrivateChoiceBodyV1 } from './open-private-choice'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import * as p from './open-contract-parse'
export function applyTtrpgOpenPrivateChoiceDisclosureEventV1(state: ProductRuntimeState,event: ProductRuntimeEvent,payload: ProductRuntimeJsonObjectV1) {
  if (event.type !== 'ttrpg.open.choice.disclosed') return false
  p.exact(payload,['operationKey','frozenPlanHash','disclosure','intent'],'private disclosure event')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg),disclosure = parseTtrpgOpenPrivateChoiceDisclosureV1(payload.disclosure)
  const op = runtime?.openRun?.operations.find(o => o.operationKey === payload.operationKey)
  if (!runtime?.authorization || !op || payload.frozenPlanHash !== op.planHash) p.fail('告知缺少真实操作或授权')
  const seat = assertTtrpgOpenHumanHostV1(runtime.authorization,disclosure.viewerKey)
  const epoch = runtime.openRun!.coordination.epochs.find(e => e.epochKey === op.authorizationEpochKey)
  if (event.actorKey !== seat.actorKey || !epoch || epoch.status !== 'active' || epoch.authorizationHash !== op.plan.authorizationHash
    || disclosure.sourceRef.sessionKey !== runtime.sessionKey || disclosure.sourceRef.sequence !== event.sequence
    || stable(disclosure.body) !== stable(buildTtrpgOpenPrivateChoiceBodyV1({ state,runtime,operation: op,kind: disclosure.body.kind,templateKey: disclosure.body.templateKey }))) p.fail('告知与实际裁定、后果或主持权限不一致')
  const intent = p.object(payload.intent,'private disclosure intent')
  if (intent.viewerKey !== disclosure.viewerKey || intent.reviewHash !== disclosure.reviewHash || intent.kind !== disclosure.body.kind || intent.templateKey !== disclosure.body.templateKey) p.fail('告知 intent 未绑定此人工确认')
  if ((op.privateChoiceDisclosures?.length ?? 0) >= 100 || op.privateChoiceDisclosures?.some(d => d.reviewHash === disclosure.reviewHash)) p.fail('重复告知或超过有界审查次数')
  op.privateChoiceDisclosures = [...(op.privateChoiceDisclosures ?? []),disclosure]
  state.ttrpg = runtime
  return true
}
