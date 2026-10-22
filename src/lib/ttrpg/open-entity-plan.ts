import { ttrpgOpenEntityDisclosureV1, ttrpgOpenEntityIdentityCatalogV1, ttrpgOpenEntityReferenceVisibleV1 } from './open-entity-catalog'
export { ttrpgOpenEntityDisclosureV1, ttrpgOpenEntityIdentityCatalogV1 } from './open-entity-catalog'
/** Deterministic F13 planning only. A plan cannot create entities, inventory, facts or seats. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { isTtrpgOpenPassiveEpochV1, ttrpgOpenScopedKeyV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenEntityOperationV1, parseTtrpgOpenEntityPlanV1, parseTtrpgOpenEntityPlanV2, parseTtrpgOpenEntityProposalV1, type TtrpgOpenEntityOperationV1 } from './open-entity-contract'
import { parseTtrpgOpenEntityModelOriginV1, ttrpgOpenModelEntityDisclosureV1, type TtrpgOpenEntityModelOriginV1 } from './open-entity-model-origin-contract'
import { ttrpgOpenMechanicalStateHashV1 } from './open-rule-plan'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'
import { countTtrpgOpenEntityInstancesV1, compileTtrpgOpenEntityMechanicsV1 } from './open-entity-mechanics'


export interface TtrpgOpenEntityPlanInputV1 {
  state: ProductRuntimeState; content: TtrpgRuntimeContentV2; runtimeSourceHash: string; viewerKey: string;
  commandId: string; sequence: number; oracleSourceRef: TtrpgOpenSourceRefV1; proposals: unknown[];
  previousOperations: readonly TtrpgOpenEntityOperationV1[];
}
export async function createTtrpgOpenEntityPlanV1(input: TtrpgOpenEntityPlanInputV1) {
  return parseTtrpgOpenEntityPlanV1(await createEntityPlan(input))
}
/** Uses shared mechanical planning, never the human-origin command or admission contract. */
export async function createTtrpgOpenEntityPlanV2(input: TtrpgOpenEntityPlanInputV1, modelOrigin: TtrpgOpenEntityModelOriginV1) {
  return parseTtrpgOpenEntityPlanV2(await createEntityPlan(input, parseTtrpgOpenEntityModelOriginV1(modelOrigin)))
}
async function createEntityPlan(input: TtrpgOpenEntityPlanInputV1, modelOrigin?: TtrpgOpenEntityModelOriginV1) {
  const runtime = parseTtrpgRuntimeStateV2(input.state.ttrpg), auth = runtime?.authorization, run = runtime?.openRun
  if (!runtime || !auth || !run || runtime.product.safety.status !== 'active' || run.stage.status !== 'open') p.fail('实体计划需要当前有效且未暂停的团局')
  const seat = assertTtrpgOpenHumanHostV1(auth, input.viewerKey), humanGm = seat.role === 'gm'
  const epoch = run.coordination.epochs.find(row => row.epochKey === run.coordination.activeEpochKey)
  const oracle = run.oracleReceipts?.find(row => stable(row.sourceRef) === stable(input.oracleSourceRef))
  const previous = input.previousOperations.map(parseTtrpgOpenEntityOperationV1)
  if (!epoch || epoch.status !== 'active' || epoch.viewerKey !== input.viewerKey || isTtrpgOpenPassiveEpochV1(epoch)
    || epoch.manualAction || epoch.hostingDelegation && !epoch.hostingDelegation.stoppedRef
    || epoch.authorizationHash !== await hash(auth) || !oracle || oracle.viewerKey !== input.viewerKey || oracle.authorizationEpochKey !== epoch.epochKey
    || oracle.sourceRef.sessionKey !== runtime.sessionKey || oracle.sourceRef.sequence >= input.sequence
    || run.operations.some(row => ['awaiting-approval', 'executing'].includes(row.status))
    || previous.some(row => row.resolution === null)
    || run.coordination.calls.some(row => row.authorizationEpochKey === epoch.epochKey && ['prepared', 'dispatched', 'unknown'].includes(row.status))
    || runtime.branchLineage?.recoveryTasks.some(row => !['completed', 'withdrawn'].includes(row.status))) p.fail('实体计划缺少本次原 Oracle、活动授权或空闲结算窗口')
  if (!humanGm && oracle.audience === 'gm-only') p.fail('玩家主持不能借用未披露 Oracle')
  if (input.content.campaign.campaignKey !== runtime.product.campaignKey || input.content.rulePack.contentHash !== runtime.product.rulePackContentHash
    || stable(oracle.frozenRulePack) !== stable(input.content.rulePack.content)) p.fail('实体计划的冻结来源或规则不一致')
  const oracleTable = input.content.rulePack.content.oracles.find(row => row.oracleKey === oracle.resolution.outcome.oracleKey) ?? p.fail('实体计划没有原冻结 Oracle')
  const committed = previous.filter(row => row.resolution?.kind === 'materialized')
  const usedByOracle = committed.filter(row => stable(row.plan.oracleSourceRef) === stable(oracle.sourceRef))
    .reduce((n, row) => n + countTtrpgOpenEntityInstancesV1(input.content, row.plan.items.map(item => item.proposal)), 0)
  const proposals = p.list(input.proposals, 'entity proposals', parseTtrpgOpenEntityProposalV1, 3, 1)
  if (usedByOracle + countTtrpgOpenEntityInstancesV1(input.content, proposals) > oracleTable.interpretation.maxNewEntities) p.fail('本次 Oracle 创建数量超过冻结上限（含 NPC 初始装备）')
  const operationKey = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'entity-operation', [p.key(input.commandId, 'entity root command')])
  const catalog = ttrpgOpenEntityIdentityCatalogV1(input.content, previous)
  const identity = (key: string, kind: 'actor' | 'location') => {
    const ref = catalog.find(row => row.entityKey === key && row.kind === kind), actual = input.state.entities[key]
    if (!ref || !actual || actual.lifecycleStatus !== 'active' || !ttrpgOpenEntityReferenceVisibleV1(ref.audience, ref.recipientActorKeys, seat.actorKey, humanGm, ref.dynamic)) p.fail('实体初始持有人或地点未获当前可用授权')
    if (kind === 'actor' && input.content.campaign.characterTemplates.some(row => row.characterKey === key && row.role === 'player') && !auth.selectedActorKeys.includes(key)) p.fail('实体不能放入未参加本局的玩家库存')
  }
  const requiredApprovals = [{ actorKey: seat.actorKey ?? 'gm', allowedSeatKeys: [seat.seatKey] }]
  const items = await Promise.all(proposals.map(async (proposal, index) => {
    const template = input.content.campaign.dynamicEntityTemplates.find(row => row.templateKey === proposal.templateKey) ?? p.fail('没有获授权的冻结实体模板')
    if (!humanGm && !ttrpgOpenEntityReferenceVisibleV1(template.audience, template.knownByActorKeys, seat.actorKey, false, false)) p.fail('当前主持不能使用未披露模板')
    if (proposal.name.length > template.maximumNameLength || Object.keys(proposal.parameters).some(key => !template.parameters.some(row => row.parameterKey === key))
      || template.parameters.some(row => row.required && !(row.parameterKey in proposal.parameters)
        || row.parameterKey in proposal.parameters && !row.allowedValues.includes(proposal.parameters[row.parameterKey]))) p.fail('实体名称或参数超出冻结模板')
    const proposedCount = proposals.filter(row => row.templateKey === proposal.templateKey).length
    const used = committed.reduce((n, row) => n + row.plan.items.filter(item => item.proposal.templateKey === template.templateKey).length, 0)
    if (used + proposedCount > template.maximumInstances) p.fail('实体模板实例数量超过冻结上限')
    if (template.kind === 'actor' && !input.content.campaign.characterTemplates.some(row => row.characterKey === template.characterTemplateKey && row.role === 'npc' && row.controller === 'gm' && row.seatKey === null)) p.fail('动态角色只能实例化冻结 NPC')
    if (template.kind === 'item' && !input.content.rulePack.content.items.some(row => row.key === template.itemDefinitionKey)) p.fail('动态物品没有冻结机械定义')
    if (proposal.locationRef !== null) identity(proposal.locationRef, 'location')
    if (proposal.ownerRef !== null) {
      identity(proposal.ownerRef, 'actor')
      const affected = auth.seats.find(row => row.role === 'player' && row.actorKey === proposal.ownerRef)
      if (affected && !requiredApprovals.some(row => row.actorKey === affected.actorKey)) {
        const allowedSeatKeys = affected.controller !== 'ai' ? [affected.seatKey] : auth.approvalBindings.find(row => row.companionActorKey === affected.actorKey)?.approverSeatKeys ?? []
        if (!allowedSeatKeys.length) p.fail('受影响库存没有真人批准关系')
        requiredApprovals.push({ actorKey: affected.actorKey!, allowedSeatKeys: [...allowedSeatKeys] })
      }
    }
    const disclosure = modelOrigin ? ttrpgOpenModelEntityDisclosureV1(modelOrigin, template, oracle.audience, auth.selectedActorKeys, humanGm)
      : ttrpgOpenEntityDisclosureV1(template, oracle.audience, auth.selectedActorKeys)
    if (proposal.ownerRef && auth.selectedActorKeys.includes(proposal.ownerRef) && disclosure.audience !== 'public'
      && !disclosure.recipientActorKeys.some(key => key === proposal.ownerRef)) p.fail('新增库存物品必须向实际受影响角色披露，不能暗中加入玩家库存')
    const entityKey = 'entity.' + (await hash({ sessionKey: runtime.sessionKey, operationKey, index })).slice(0, 48)
    if (input.state.entities[entityKey] || catalog.some(row => row.entityKey === entityKey)) p.fail('内核实体身份已存在，不能覆盖原实例')
    return { entityKey, kind: template.kind, proposal, templateHash: await hash(template), ...disclosure }
  }))
  requiredApprovals.sort((a, b) => a.actorKey.localeCompare(b.actorKey))
  const compiled = compileTtrpgOpenEntityMechanicsV1({ content: input.content, items, eventSequence: input.sequence })
  if (compiled.entities.some(row => input.state.entities[row.entityKey] || catalog.some(prior => prior.entityKey === row.entityKey))) p.fail('实体或初始装备身份已经存在，不能覆盖')
  const body = { schema: 'storyforge.ttrpg-open-entity-plan' as const, version: modelOrigin ? 2 : 1, operationKey, rootCommandId: input.commandId,
    proposedRef: { sessionKey: runtime.sessionKey, sequence: input.sequence }, oracleSourceRef: oracle.sourceRef,
    authorizationEpochKey: epoch.epochKey, authorizationHash: await hash(auth), viewerKey: input.viewerKey, seatKey: seat.seatKey,
    runtimeSourceHash: p.hash(input.runtimeSourceHash, 'entity runtime source'), rulePackContentHash: input.content.rulePack.contentHash,
    mechanicalStateHash: await ttrpgOpenMechanicalStateHashV1(input.state), frozenContentJson: stable(input.content), items, requiredApprovals,
    ...(modelOrigin ? { modelOrigin } : {}) }
  return { ...body, planHash: await hash(body) }
}
