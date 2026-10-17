import { isTtrpgOpenPassiveEpochV1 } from './open-coordination'
/** A human grants one bounded window; this never grants player decisions or renews budgets. */
import type { ProductRuntimeEvent,ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { assertTtrpgOpenModelActorV1 } from './open-model-purpose'
import { ttrpgOpenCallBudgetV1 } from './open-model-calls'
import { TTRPG_OPEN_HOSTING_CAPABILITIES_V1,parseTtrpgOpenHostingDelegationV1,type TtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'

function owner(state: ProductRuntimeState,epochKey: string,viewerKey: string) {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg),run = runtime?.openRun,auth = runtime?.authorization
  const epoch = run?.coordination.epochs.find(e => e.epochKey === epochKey)
  if (!runtime || !run || !auth || !epoch || epoch.status !== 'active' || run.coordination.activeEpochKey !== epochKey
    || epoch.viewerKey !== viewerKey || epoch.sessionZeroRevision !== auth.revision) p.fail('有限主持委托需要当前原真人窗口')
  const seat = assertTtrpgOpenHumanHostV1(auth,viewerKey)
  if (seat.seatKey !== epoch.triggeredBySeatKey) p.fail('不能借用其他真人的主持窗口')
  return { runtime,run,auth,epoch,seat }
}
export function createTtrpgOpenHostingDelegationV1(state: ProductRuntimeState,input: {
  epochKey: string;viewerKey: string;maximumCostUsdPerCall: number;sequence: number
}) {
  const f = owner(state,input.epochKey,input.viewerKey)
  if (input.sequence !== state.lastSequence + 1) p.fail('有限主持委托必须来自下一真实事件')
  assertTtrpgOpenModelActorV1(f.auth,'prose.ttrpg-open-kp','gm',input.viewerKey)
  if (isTtrpgOpenPassiveEpochV1(f.epoch) || f.epoch.hostingDelegation || f.epoch.manualAction || f.runtime.product.safety.status !== 'active' || f.run.stage.status !== 'open'
    || f.runtime.branchLineage?.recoveryTasks.some(t => !['completed','withdrawn'].includes(t.status))) p.fail('当前窗口不能新授予有限主持委托')
  return parseTtrpgOpenHostingDelegationV1({ schema: 'storyforge.ttrpg-open-hosting-delegation',version: 1,
    epochKey: f.epoch.epochKey,viewerKey: input.viewerKey,sourceRef: { sessionKey: f.runtime.sessionKey,sequence: input.sequence },authorizationRef: f.auth.sourceRef,
    capabilities: [...TTRPG_OPEN_HOSTING_CAPABILITIES_V1],maximumCostUsdPerCall: p.number(input.maximumCostUsdPerCall,'hosting per-call budget',0,f.epoch.budget.maximumCostUsd),stoppedRef: null,stopReason: null })
}
export function assertTtrpgOpenHostingDelegationV1(state: ProductRuntimeState,input: {
  epochKey: string;viewerKey: string;delegationRef: TtrpgOpenSourceRefV1
}) {
  const f = owner(state,input.epochKey,input.viewerKey),permission = f.epoch.hostingDelegation
  if (!permission || permission.stoppedRef || stable(permission.sourceRef) !== stable(input.delegationRef)
    || stable(permission.authorizationRef) !== stable(f.auth.sourceRef) || f.runtime.product.safety.status !== 'active'
    || f.runtime.branchLineage?.recoveryTasks.some(t => !['completed','withdrawn'].includes(t.status))) p.fail('本轮有限主持委托已停止、过期或不属于当前来源')
  assertTtrpgOpenModelActorV1(f.auth,'prose.ttrpg-open-kp','gm',input.viewerKey)
  return { ...f,permission }
}
export function applyTtrpgOpenHostingDelegationEventV1(state: ProductRuntimeState,event: ProductRuntimeEvent,payload: ProductRuntimeJsonObjectV1): boolean {
  if (!['ttrpg.open.hosting.delegated','ttrpg.open.hosting.stopped'].includes(event.type)) return false
  const start = event.type === 'ttrpg.open.hosting.delegated'
  p.exact(payload,['epochKey','viewerKey',start ? 'permission' : 'reason','intent'],'hosting authority event')
  const intent = p.record(payload.intent,start ? ['epochKey','viewerKey','maximumCostUsdPerCall','decision'] : ['epochKey','viewerKey','reason'],'hosting authority intent')
  const epochKey = p.key(payload.epochKey,'hosting epoch'),viewerKey = p.key(payload.viewerKey,'hosting viewer'),f = owner(state,epochKey,viewerKey)
  if (intent.epochKey !== epochKey || intent.viewerKey !== viewerKey || event.actorKey !== f.seat.actorKey || event.targetKey !== null) p.fail('有限主持委托没有原真人的明确决定')
  if (start) {
    p.literal(intent.decision,'delegate-this-epoch','explicit bounded delegation')
    const expected = createTtrpgOpenHostingDelegationV1(state,{ epochKey,viewerKey,maximumCostUsdPerCall: p.number(intent.maximumCostUsdPerCall,'per-call reservation',0,1000),sequence: event.sequence })
    if (stable(expected) !== stable(payload.permission)) p.fail('有限主持委托不是当前授权与原预算的精确回执')
    f.epoch.hostingDelegation = expected
  } else {
    const reason = p.text(payload.reason,'hosting stop reason',2000)
    if (!f.epoch.hostingDelegation || f.epoch.hostingDelegation.stoppedRef || intent.reason !== reason) p.fail('有限主持委托不存在、已停止或原因不一致')
    f.epoch.hostingDelegation.stoppedRef = { sessionKey: f.runtime.sessionKey,sequence: event.sequence };f.epoch.hostingDelegation.stopReason = reason
  }
  state.ttrpg = f.runtime
  return true
}

/** Read-only preflight for the forthcoming coordinator; formal reserve/dispatch still own the actual call. */
export function assertTtrpgOpenHostingRequestV1(state: ProductRuntimeState,input: {
  epochKey: string;viewerKey: string;delegationRef: TtrpgOpenSourceRefV1;purpose: 'companion' | 'kp-narration';actorKey: string;maximumCostUsd: number
}) {
  const f = assertTtrpgOpenHostingDelegationV1(state,input),purpose = p.oneOf(input.purpose,['companion','kp-narration'],'delegated request purpose')
  assertTtrpgOpenModelActorV1(f.auth,purpose === 'companion' ? 'prose.ttrpg-open-companion' : 'prose.ttrpg-open-kp',input.actorKey,input.viewerKey)
  const cost = p.number(input.maximumCostUsd,'delegated call reservation',0,f.permission.maximumCostUsdPerCall),budget = ttrpgOpenCallBudgetV1(f.epoch,f.run.coordination.calls)
  if (budget.blockedByUnknown || budget.blockedByDenial || budget.pending || budget.countedRequests >= f.epoch.budget.maximumCalls
    || budget.committedOrReservedTokens >= f.epoch.budget.maximumTokens || budget.committedOrReservedCostUsd + cost > f.epoch.budget.maximumCostUsd) p.fail('有限主持必须等待原请求回执或新的明确预算授权')
  if (purpose === 'companion' && (f.run.stage.status !== 'open' || f.epoch.successfulActorKeys.length >= f.epoch.budget.maximumAiActions
    || f.run.coordination.calls.some(c => c.authorizationEpochKey === f.epoch.epochKey && c.actorKey === input.actorKey && c.skillId === 'prose.ttrpg-open-companion'))) p.fail('有限主持不能重发同一队友或绕过本轮行动上限')
  return f
}

/** A system proposal is evidence-bound; it is not a fresh human semantic confirmation. */
export function assertTtrpgOpenDelegatedCompanionProposalV1(state: ProductRuntimeState,input: {
  epochKey: string;viewerKey: string;delegationRef: TtrpgOpenSourceRefV1;runContractHash: string;actorKey: string
}) {
  const f = assertTtrpgOpenHostingDelegationV1(state,input)
  const call = f.run.coordination.calls.find(c => c.runContractHash === input.runContractHash && c.actorKey === input.actorKey)
  const budget = ttrpgOpenCallBudgetV1(f.epoch,f.run.coordination.calls)
  if (!call || call.skillId !== 'prose.ttrpg-open-companion' || call.status !== 'succeeded' || call.intentRejection
    || call.authorizationEpochKey !== f.epoch.epochKey || stable(call.hostingDelegationRef) !== stable(f.permission.sourceRef)
    || budget.blockedByUnknown || budget.blockedByDenial || budget.pending || f.run.stage.status !== 'open') p.fail('队友系统提案缺少同窗口真实请求与仍有效的有限委托')
  assertTtrpgOpenModelActorV1(f.auth,'prose.ttrpg-open-companion',input.actorKey,input.viewerKey)
  return { ...f,call }
}

export function assertTtrpgOpenDelegatedNarrationV1(state: ProductRuntimeState,input: {
  epochKey: string;viewerKey: string;delegationRef: TtrpgOpenSourceRefV1;requestKey: string
}) {
  const f = assertTtrpgOpenHostingDelegationV1(state,input),call = f.run.coordination.calls.find(c => c.requestKey === input.requestKey)
  const budget = ttrpgOpenCallBudgetV1(f.epoch,f.run.coordination.calls)
  if (!call || call.skillId !== 'prose.ttrpg-open-kp' || call.status !== 'succeeded' || call.authorizationEpochKey !== f.epoch.epochKey
    || stable(call.hostingDelegationRef) !== stable(f.permission.sourceRef) || budget.blockedByUnknown || budget.blockedByDenial || budget.pending) p.fail('KP 系统采用缺少同窗口真实请求与仍有效的有限委托')
  return { ...f,call }
}
