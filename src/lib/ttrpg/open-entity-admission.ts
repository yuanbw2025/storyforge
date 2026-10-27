/** Pure F13 replay admission: no model, database write, state hash forgery or implicit approval. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenEntityPlan, TtrpgOpenEntityOperationV1 } from './open-entity-contract'
import { assertTtrpgOpenEntityModelPlanCallV1 } from './open-entity-model-origin-contract'
import { ttrpgOpenModelEntityDisclosureV1 } from './open-entity-model-origin-contract'
import type { TtrpgOpenAuthorizationV1 } from './open-authorization'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { isTtrpgOpenPassiveEpochV1 } from './open-coordination'
import { ttrpgOpenEntityDisclosureV1, ttrpgOpenEntityIdentityCatalogV1, ttrpgOpenEntityReferenceVisibleV1 } from './open-entity-catalog'
import { countTtrpgOpenEntityInstancesV1, compileTtrpgOpenEntityMechanicsV1 } from './open-entity-mechanics'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'

export function ttrpgOpenEntityRequiredApprovalsV1(auth: TtrpgOpenAuthorizationV1, viewerKey: string, plan: Pick<TtrpgOpenEntityPlan, 'items'>) {
  const host = assertTtrpgOpenHumanHostV1(auth, viewerKey), required = [{ actorKey: host.actorKey ?? 'gm', allowedSeatKeys: [host.seatKey] }]
  for (const { proposal } of plan.items) {
    const actor = auth.seats.find(row => row.role === 'player' && row.actorKey === proposal.ownerRef)
    if (!actor || required.some(row => row.actorKey === actor.actorKey)) continue
    const allowedSeatKeys = actor.controller !== 'ai' ? [actor.seatKey] : auth.approvalBindings.find(row => row.companionActorKey === actor.actorKey)?.approverSeatKeys ?? []
    if (!allowedSeatKeys.length) p.fail('实体库存改变没有真实真人批准关系')
    required.push({ actorKey: actor.actorKey!, allowedSeatKeys: [...allowedSeatKeys] })
  }
  return required.sort((a, b) => a.actorKey.localeCompare(b.actorKey))
}
export function assertTtrpgOpenEntityPlanAdmissionV1(input: { state: ProductRuntimeState; content: TtrpgRuntimeContentV2; plan: TtrpgOpenEntityPlan; previous: readonly TtrpgOpenEntityOperationV1[] }) {
  const { content, plan } = input, runtime = parseTtrpgRuntimeStateV2(input.state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth || runtime.product.safety.status !== 'active' || run.stage.status !== 'open') p.fail('实体计划需要有效未暂停的团局')
  if (plan.frozenContentJson !== stable(content)) p.fail('实体计划不能更换原冻结定义')
  const host = assertTtrpgOpenHumanHostV1(auth, plan.viewerKey), epoch = run.coordination.epochs.find(row => row.epochKey === run.coordination.activeEpochKey)
  const oracle = run.oracleReceipts?.find(row => stable(row.sourceRef) === stable(plan.oracleSourceRef))
  if (!epoch || epoch.status !== 'active' || isTtrpgOpenPassiveEpochV1(epoch) || epoch.epochKey !== plan.authorizationEpochKey || epoch.viewerKey !== plan.viewerKey
    || epoch.manualAction || epoch.hostingDelegation && !epoch.hostingDelegation.stoppedRef
    || epoch.authorizationHash !== plan.authorizationHash || host.seatKey !== plan.seatKey || !oracle || oracle.viewerKey !== plan.viewerKey
    || oracle.authorizationEpochKey !== epoch.epochKey || plan.proposedRef.sessionKey !== runtime.sessionKey
    || oracle.sourceRef.sessionKey !== runtime.sessionKey || oracle.sourceRef.sequence >= plan.proposedRef.sequence
    || host.role !== 'gm' && oracle.audience === 'gm-only'
    || plan.rulePackContentHash !== content.rulePack.contentHash || content.campaign.campaignKey !== runtime.product.campaignKey
    || stable(oracle.frozenRulePack) !== stable(content.rulePack.content)
    || run.operations.some(row => ['executing', 'awaiting-approval'].includes(row.status)) || input.previous.some(row => !row.resolution)
    || run.coordination.calls.some(row => row.authorizationEpochKey === epoch.epochKey && ['prepared', 'dispatched', 'unknown'].includes(row.status))
    || runtime.branchLineage?.recoveryTasks.some(row => !['completed', 'withdrawn'].includes(row.status))) p.fail('实体计划没有同一原咨询、冻结规则与空闲授权窗口')
  if (stable(plan.requiredApprovals) !== stable(ttrpgOpenEntityRequiredApprovalsV1(auth, plan.viewerKey, plan))) p.fail('实体计划不能删减或扩大受影响者批准权限')
  if (plan.version === 2) assertTtrpgOpenEntityModelPlanCallV1(plan, run)
  const committed = input.previous.filter(row => row.resolution?.kind === 'materialized')
  const oracleTable = content.rulePack.content.oracles.find(row => row.oracleKey === oracle.resolution.outcome.oracleKey) ?? p.fail('实体没有原冻结 Oracle')
  const used = committed.filter(row => stable(row.plan.oracleSourceRef) === stable(plan.oracleSourceRef)).reduce((sum, row) => sum + countTtrpgOpenEntityInstancesV1(content, row.plan.items.map(item => item.proposal)), 0)
  if (used + countTtrpgOpenEntityInstancesV1(content, plan.items.map(item => item.proposal)) > oracleTable.interpretation.maxNewEntities) p.fail('实体创建超出本次原咨询配额')
  const catalog = ttrpgOpenEntityIdentityCatalogV1(content, input.previous)
  for (const { proposal, kind, audience, recipientActorKeys } of plan.items) {
    const template = content.campaign.dynamicEntityTemplates.find(row => row.templateKey === proposal.templateKey) ?? p.fail('实体没有冻结模板')
    if (template.kind !== kind || proposal.name.length > template.maximumNameLength
      || Object.keys(proposal.parameters).some(key => !template.parameters.some(row => row.parameterKey === key))
      || template.parameters.some(row => row.required && !(row.parameterKey in proposal.parameters) || row.parameterKey in proposal.parameters && !row.allowedValues.includes(proposal.parameters[row.parameterKey]))
      || !ttrpgOpenEntityReferenceVisibleV1(template.audience, template.knownByActorKeys, host.actorKey, host.role === 'gm', false)
      || stable({ audience, recipientActorKeys }) !== stable(plan.version === 2
        ? ttrpgOpenModelEntityDisclosureV1(plan.modelOrigin, template, oracle.audience, auth.selectedActorKeys, host.role === 'gm')
        : ttrpgOpenEntityDisclosureV1(template, oracle.audience, auth.selectedActorKeys))) p.fail('实体模板、参数或披露范围未获原授权')
    const total = committed.flatMap(row => row.plan.items).filter(row => row.proposal.templateKey === template.templateKey).length + plan.items.filter(row => row.proposal.templateKey === template.templateKey).length
    if (total > template.maximumInstances) p.fail('实体模板实例数超限')
    if (proposal.ownerRef && auth.selectedActorKeys.includes(proposal.ownerRef) && audience !== 'public'
      && !recipientActorKeys.includes(proposal.ownerRef)) p.fail('新增库存物品必须向实际受影响角色披露')
    for (const [ref, expectedKind] of [[proposal.locationRef, 'location'], [proposal.ownerRef, 'actor']] as const) if (ref !== null) {
      const identity = catalog.find(row => row.entityKey === ref && row.kind === expectedKind), actual = input.state.entities[ref]
      if (!identity || !actual || actual.lifecycleStatus !== 'active' || !ttrpgOpenEntityReferenceVisibleV1(identity.audience, identity.recipientActorKeys, host.actorKey, host.role === 'gm', identity.dynamic)
        || expectedKind === 'actor' && content.campaign.characterTemplates.some(row => row.characterKey === ref && row.role === 'player') && !auth.selectedActorKeys.includes(ref)) p.fail('实体初始位置或库存 owner 不属于当前合法实例')
      if (plan.version === 2 && (audience === 'public' ? identity.audience !== 'public' : audience !== 'gm-only'
        && recipientActorKeys.some(actor => !ttrpgOpenEntityReferenceVisibleV1(identity.audience, identity.recipientActorKeys, actor, false, identity.dynamic)))) p.fail('模型实体位置或持有人不得超出本次完整交付范围')
    }
  }
  const compiled = compileTtrpgOpenEntityMechanicsV1({ content, items: plan.items, eventSequence: plan.proposedRef.sequence })
  if (compiled.entities.some(row => input.state.entities[row.entityKey] || catalog.some(prior => prior.entityKey === row.entityKey))) p.fail('实体身份已存在，不能覆盖原对象')
  return { runtime, run, auth, host, oracle }
}
