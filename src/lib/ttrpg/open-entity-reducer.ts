/** Only F13 materialization commits compiled entity/inventory state; other steps are permission journals. */
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import type { TtrpgRuntimeContentV2 } from './content-version'
import { parseTtrpgRuntimeContentVersionedV1, isTtrpgRuntimeContentV2 } from './content-version'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenEntityPlan, parseTtrpgOpenEntityProposalV1 } from './open-entity-contract'
import { assertTtrpgOpenEntityPlanAdmissionV1 } from './open-entity-admission'
import { assertTtrpgOpenEntityPlanEnvelopeV1, ttrpgOpenEntityOperationBasisV1 } from './open-entity-operation-basis'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { compileTtrpgOpenEntityMechanicsV1 } from './open-entity-mechanics'
import { applyTtrpgItemCommandV2, ttrpgItemDefinitionFromRuleV1 } from './item-ledger'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'
function frozen(value: unknown): TtrpgRuntimeContentV2 {
  const raw = p.object(value, 'entity frozen content'), source = p.object(p.object(raw.campaign, 'entity campaign').sourceWorld, 'entity source')
  const content = parseTtrpgRuntimeContentVersionedV1(raw, p.hash(source.contentHash, 'entity frozen world'), 2)
  return isTtrpgRuntimeContentV2(content) ? content : p.fail('实体创建只允许冻结 open 内容')
}
export function applyTtrpgOpenEntityEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (!['ttrpg.open.entity.proposed', 'ttrpg.open.entity.model-proposed', 'ttrpg.open.entity.confirmed', 'ttrpg.open.entity.materialized', 'ttrpg.open.entity.disposed'].includes(event.type)) return false
  const sourceRef = { sessionKey: state.ttrpg?.sessionKey ?? '', sequence: event.sequence }
  if (event.type === 'ttrpg.open.entity.proposed' || event.type === 'ttrpg.open.entity.model-proposed') {
    p.exact(payload, ['plan', 'intent'], 'entity proposed payload')
    const plan = parseTtrpgOpenEntityPlan(payload.plan), content = frozen(JSON.parse(plan.frozenContentJson))
    let viewerKey: string
    if (event.type === 'ttrpg.open.entity.model-proposed') {
      const intent = p.record(payload.intent, ['origin', 'viewerKey', 'requestKey', 'candidateHash', 'decision'], 'model entity adoption intent')
      if (plan.version !== 2 || intent.origin !== 'model-entity-candidate' || intent.decision !== 'reviewed-this-model-entity-candidate'
        || intent.requestKey !== plan.modelOrigin.call.requestKey || intent.candidateHash !== plan.modelOrigin.candidateHash) p.fail('模型实体计划必须保留原模型来源与精确审阅决定')
      viewerKey = p.key(intent.viewerKey, 'entity reviewer')
    } else {
      const intent = p.record(payload.intent, ['origin', 'viewerKey', 'oracleSourceRef', 'proposals'], 'human entity proposal intent')
      p.literal(intent.origin, 'human-oracle-proposal', 'entity proposal author')
      if (plan.version !== 1 || stable(p.list(intent.proposals, 'entity original proposals', parseTtrpgOpenEntityProposalV1, 3, 1)) !== stable(plan.items.map(row => row.proposal))
        || stable(intent.oracleSourceRef) !== stable(plan.oracleSourceRef)) p.fail('人工实体计划不是原明确提出的 V1 候选')
      viewerKey = p.key(intent.viewerKey, 'entity author')
    }
    assertTtrpgOpenEntityPlanEnvelopeV1(plan, { sequence: event.sequence, sessionKey: sourceRef.sessionKey, viewerKey, commandId: event.commandId ?? '' })
    const current = parseTtrpgRuntimeStateV2(state.ttrpg)!, previous = current.openRun?.entityOperations ?? []
    const basis = assertTtrpgOpenEntityPlanAdmissionV1({ state, content, plan, previous })
    if (event.actorKey !== (basis.host.actorKey ?? 'gm') || event.targetKey !== plan.operationKey || previous.some(row => row.plan.operationKey === plan.operationKey)) p.fail('实体候选事件身份不一致或已存在')
    basis.run.entityOperations = [...previous, { plan, approvals: [], resolution: null }]; state.ttrpg = basis.runtime
    return true
  }
  p.exact(payload, event.type === 'ttrpg.open.entity.materialized' ? ['operationKey', 'planHash', 'intent']
    : event.type === 'ttrpg.open.entity.confirmed' ? ['operationKey', 'planHash', 'intent'] : ['operationKey', 'planHash', 'intent'], 'entity operation payload')
  const operationKey = p.key(payload.operationKey, 'entity operation'), planHash = p.hash(payload.planHash, 'entity plan version')
  const basis = ttrpgOpenEntityOperationBasisV1(state, operationKey, planHash), { runtime, run, auth, operation, plan } = basis
  const epoch = run.coordination.epochs.find(row => row.epochKey === run.coordination.activeEpochKey)
  const isDisposal = event.type === 'ttrpg.open.entity.disposed'
  const intent = p.record(payload.intent, event.type === 'ttrpg.open.entity.confirmed' ? ['viewerKey', 'operationKey', 'planHash', 'actorKey', 'decision']
    : isDisposal ? ['viewerKey', 'operationKey', 'planHash', 'reason'] : ['viewerKey', 'operationKey', 'planHash'], 'entity operation intent')
  const viewerKey = p.key(intent.viewerKey, 'entity operation viewer'), seat = auth.seats.find(row => row.viewerKey === viewerKey)
  if (operation.resolution || plan.proposedRef.sessionKey !== runtime.sessionKey || !epoch || epoch.status !== 'active' || epoch.epochKey !== plan.authorizationEpochKey
    || plan.authorizationHash !== epoch.authorizationHash || run.stage.status !== 'open' || !isDisposal && runtime.product.safety.status !== 'active'
    || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || intent.operationKey !== operationKey || intent.planHash !== planHash
    || event.targetKey !== operationKey) p.fail('实体原计划已结束或未获当前实际授权')
  if (event.type === 'ttrpg.open.entity.confirmed') {
    const actorKey = p.key(intent.actorKey, 'entity affected actor'), decision = p.oneOf(intent.decision, ['approve', 'reject'], 'entity decision')
    if (event.actorKey !== actorKey || !plan.requiredApprovals.some(row => row.actorKey === actorKey && row.allowedSeatKeys.includes(seat.seatKey))
      || operation.approvals.some(row => row.actorKey === actorKey)) p.fail('实体确认不是该受影响者的本次明确决定')
    operation.approvals.push({ actorKey, approverSeatKey: seat.seatKey, viewerKey, decision, sourceRef })
  } else if (isDisposal) {
    if (viewerKey !== plan.viewerKey && !operation.approvals.some(row => row.viewerKey === viewerKey && row.decision === 'reject')) p.fail('只有原主持或实际拒绝者可结束未创建计划')
    if (event.actorKey !== (seat.actorKey ?? 'gm')) p.fail('实体放弃身份不一致')
    operation.resolution = { kind: 'declined', sourceRef, reason: p.text(intent.reason, 'entity disposal reason', 2000) }
  } else {
    assertTtrpgOpenHumanHostV1(auth, viewerKey)
    if (viewerKey !== plan.viewerKey || event.actorKey !== (seat.actorKey ?? 'gm') || operation.approvals.length !== plan.requiredApprovals.length || operation.approvals.some(row => row.decision !== 'approve')) p.fail('实体创建缺少全部受影响者的明确确认')
    const content = frozen(JSON.parse(plan.frozenContentJson))
    assertTtrpgOpenEntityPlanAdmissionV1({ state, content, plan, previous: (run.entityOperations ?? []).filter(row => row !== operation) })
    const compiled = compileTtrpgOpenEntityMechanicsV1({ content, items: plan.items, eventSequence: event.sequence })
    if (Object.keys(compiled.abilities).some(key => runtime.product.abilityStates[key])) p.fail('实体能力身份不能覆盖原账本')
    const definitions = Object.fromEntries(content.rulePack.content.items.map(row => [row.key, ttrpgItemDefinitionFromRuleV1(row)]))
    let inventory = runtime.product.inventory
    for (const command of compiled.inventoryCommands) inventory = applyTtrpgItemCommandV2({ state: inventory, definitions, command }).state
    for (const entity of compiled.entities) state.entities[entity.entityKey] = entity
    runtime.product.inventory = inventory; Object.assign(runtime.product.abilityStates, compiled.abilities)
    operation.resolution = { kind: 'materialized', sourceRef }
  }
  state.ttrpg = runtime
  return true
}
