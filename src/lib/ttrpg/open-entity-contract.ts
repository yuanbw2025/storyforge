/** F13 domain contract. Prose and template references never create a runtime entity. */
import type { TtrpgOpenAudience, TtrpgOpenEntityKind } from './open-contract'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'
import type { TtrpgOpenOperationApprovalV1 } from './open-operation'
import { parseTtrpgOpenEntityModelOriginV1, type TtrpgOpenEntityModelOriginV1 } from './open-entity-model-origin-contract'

export interface TtrpgOpenEntityProposalV1 {
  templateKey: string; name: string; description: string; parameters: Record<string, string>;
  locationRef: string | null; ownerRef: string | null;
}
export interface TtrpgOpenEntityPlanItemV1 {
  entityKey: string; kind: TtrpgOpenEntityKind; proposal: TtrpgOpenEntityProposalV1; templateHash: string;
  audience: TtrpgOpenAudience; recipientActorKeys: string[];
}
export interface TtrpgOpenEntityPlanV1 {
  schema: 'storyforge.ttrpg-open-entity-plan'; version: 1;
  operationKey: string; rootCommandId: string; proposedRef: TtrpgOpenSourceRefV1; oracleSourceRef: TtrpgOpenSourceRefV1;
  authorizationEpochKey: string; authorizationHash: string; viewerKey: string; seatKey: string;
  runtimeSourceHash: string; rulePackContentHash: string; mechanicalStateHash: string;
  /** Immutable evidence, compared to the actual retained source; never an authoring write or player read. */
  frozenContentJson: string;
  items: TtrpgOpenEntityPlanItemV1[]; requiredApprovals: Array<{ actorKey: string; allowedSeatKeys: string[] }>; planHash: string;
}
export interface TtrpgOpenEntityOperationV1 {
  plan: TtrpgOpenEntityPlan;
  approvals: TtrpgOpenOperationApprovalV1[];
  resolution: { kind: 'materialized'; sourceRef: TtrpgOpenSourceRefV1 }
    | { kind: 'declined'; sourceRef: TtrpgOpenSourceRefV1; reason: string } | null;
}
export interface TtrpgOpenEntityPlanV2 extends Omit<TtrpgOpenEntityPlanV1, 'version'> {
  version: 2; modelOrigin: TtrpgOpenEntityModelOriginV1;
}
export type TtrpgOpenEntityPlan = TtrpgOpenEntityPlanV1 | TtrpgOpenEntityPlanV2
export function parseTtrpgOpenEntityProposalV1(value: unknown): TtrpgOpenEntityProposalV1 {
  const r = p.record(value, ['templateKey', 'name', 'description', 'parameters', 'locationRef', 'ownerRef'], 'entity proposal')
  const parameters = p.object(r.parameters, 'entity parameters')
  if (Object.keys(parameters).length > 32) p.fail('entity parameters: 超过冻结参数上限')
  return { templateKey: p.key(r.templateKey, 'entity template'), name: p.text(r.name, 'entity name', 300), description: p.text(r.description, 'entity description', 4000),
    parameters: Object.fromEntries(Object.entries(parameters).map(([key, value]) => [p.key(key, 'entity parameter'), p.text(value, 'entity parameter value', 1000)])),
    locationRef: p.nullable(r.locationRef, p.key, 'entity location'), ownerRef: p.nullable(r.ownerRef, p.key, 'entity owner') }
}
export function parseTtrpgOpenEntityPlanV1(value: unknown): TtrpgOpenEntityPlanV1 {
  const plan = parseEntityPlan(value, 1)
  return plan.version === 1 ? plan : p.fail('人工实体计划必须保留 V1 合同')
}
export function parseTtrpgOpenEntityPlanV2(value: unknown): TtrpgOpenEntityPlanV2 {
  const plan = parseEntityPlan(value, 2)
  return plan.version === 2 ? plan : p.fail('模型实体计划必须使用 V2 来源合同')
}
export function parseTtrpgOpenEntityPlan(value: unknown): TtrpgOpenEntityPlan {
  return p.object(value, 'versioned entity plan').version === 2 ? parseTtrpgOpenEntityPlanV2(value) : parseTtrpgOpenEntityPlanV1(value)
}
function parseEntityPlan(value: unknown, version: 1 | 2): TtrpgOpenEntityPlan {
  const r = p.record(value, ['schema', 'version', 'operationKey', 'rootCommandId', 'proposedRef', 'oracleSourceRef', 'authorizationEpochKey', 'authorizationHash',
    'viewerKey', 'seatKey', 'runtimeSourceHash', 'rulePackContentHash', 'mechanicalStateHash', 'frozenContentJson', 'items', 'requiredApprovals', 'planHash', ...(version === 2 ? ['modelOrigin'] : [])], 'entity plan')
  p.literal(r.version, version, 'entity plan version')
  if (typeof r.frozenContentJson !== 'string' || !r.frozenContentJson.trim() || r.frozenContentJson.length > 8000000) p.fail('实体计划缺少完整原冻结定义证据')
  const proposedRef = parseTtrpgOpenSourceRefV1(r.proposedRef), oracleSourceRef = parseTtrpgOpenSourceRefV1(r.oracleSourceRef)
  if (proposedRef.sessionKey !== oracleSourceRef.sessionKey || oracleSourceRef.sequence >= proposedRef.sequence) p.fail('实体计划必须来自同一团局的已提交 Oracle')
  const items = p.list(r.items, 'entity plan items', value => {
    const row = p.record(value, ['entityKey', 'kind', 'proposal', 'templateHash', 'audience', 'recipientActorKeys'], 'entity plan item')
    const kind = p.oneOf(row.kind, ['actor', 'location', 'item'], 'entity kind'), audience = p.oneOf(row.audience, p.AUDIENCES, 'entity audience')
    const recipientActorKeys = p.keys(row.recipientActorKeys, 'entity recipients', 1000)
    if (audience === 'gm-only' && recipientActorKeys.length || audience === 'private' && !recipientActorKeys.length) p.fail('实体接收者与受众不一致')
    const proposal = parseTtrpgOpenEntityProposalV1(row.proposal)
    if (kind === 'location' && (proposal.locationRef !== null || proposal.ownerRef !== null)
      || kind === 'actor' && (proposal.locationRef === null || proposal.ownerRef !== null)
      || kind === 'item' && (proposal.locationRef === null) === (proposal.ownerRef === null)) p.fail('实体初始地点/持有人不符合类别')
    const entityKey = p.key(row.entityKey, 'kernel entity identity')
    if (!/^entity\.[a-f0-9]{48}$/.test(entityKey)) p.fail('实体身份必须由内核分配')
    return { entityKey, kind, proposal, templateHash: p.hash(row.templateHash, 'frozen entity template'), audience, recipientActorKeys }
  }, 3, 1)
  p.unique(items.map(item => item.entityKey), 'entity identities')
  const requiredApprovals = p.list(r.requiredApprovals, 'entity required approvals', value => {
    const row = p.record(value, ['actorKey', 'allowedSeatKeys'], 'entity required approver')
    return { actorKey: p.key(row.actorKey, 'entity affected actor'), allowedSeatKeys: p.keys(row.allowedSeatKeys, 'entity approver seats', 1000, 1) }
  }, 4, 1)
  p.unique(requiredApprovals.map(row => row.actorKey), 'entity affected actors')
  const body = { schema: p.literal(r.schema, 'storyforge.ttrpg-open-entity-plan', 'entity plan schema'),
    operationKey: p.key(r.operationKey, 'entity operation'), rootCommandId: p.key(r.rootCommandId, 'entity root command'), proposedRef, oracleSourceRef,
    authorizationEpochKey: p.key(r.authorizationEpochKey, 'entity epoch'), authorizationHash: p.hash(r.authorizationHash, 'entity authorization'),
    viewerKey: p.key(r.viewerKey, 'entity viewer'), seatKey: p.key(r.seatKey, 'entity approver'),
    runtimeSourceHash: p.hash(r.runtimeSourceHash, 'entity runtime source'), rulePackContentHash: p.hash(r.rulePackContentHash, 'entity rules'),
    mechanicalStateHash: p.hash(r.mechanicalStateHash, 'entity mechanical state'), frozenContentJson: r.frozenContentJson, items, requiredApprovals, planHash: p.hash(r.planHash, 'entity plan hash') }
  // Keep the original V1 property order as well as its closed grammar for old event/head bytes.
  const { schema, ...fields } = body
  return version === 1 ? { schema, version: 1, ...fields }
    : { schema, version: 2, ...fields, modelOrigin: parseTtrpgOpenEntityModelOriginV1(r.modelOrigin) }
}
export function parseTtrpgOpenEntityOperationV1(value: unknown): TtrpgOpenEntityOperationV1 {
  const r = p.record(value, ['plan', 'approvals', 'resolution'], 'entity operation'), plan = parseTtrpgOpenEntityPlan(r.plan)
  const approvals = p.list(r.approvals, 'entity approvals', value => {
    const row = p.record(value, ['actorKey', 'approverSeatKey', 'viewerKey', 'decision', 'sourceRef'], 'entity approval')
    const sourceRef = parseTtrpgOpenSourceRefV1(row.sourceRef), actorKey = p.key(row.actorKey, 'entity approved actor'), approverSeatKey = p.key(row.approverSeatKey, 'entity actual approver')
    if (sourceRef.sessionKey !== plan.proposedRef.sessionKey || sourceRef.sequence <= plan.proposedRef.sequence
      || !plan.requiredApprovals.some(a => a.actorKey === actorKey && a.allowedSeatKeys.includes(approverSeatKey))) p.fail('实体确认缺少原计划与受影响者授权')
    return { actorKey, approverSeatKey, viewerKey: p.key(row.viewerKey, 'entity approval viewer'), decision: p.oneOf(row.decision, ['approve', 'reject'], 'entity approval decision'), sourceRef }
  }, 4)
  p.unique(approvals.map(row => row.actorKey), 'entity approvals')
  if (approvals.some((row, index) => index > 0 && row.sourceRef.sequence <= approvals[index - 1].sourceRef.sequence)) p.fail('实体确认必须按真实事件次序保存')
  if (r.resolution === null) return { plan, approvals, resolution: null }
  const kind = p.oneOf(p.object(r.resolution, 'entity resolution').kind, ['materialized', 'declined'], 'entity resolution kind')
  const resolution = p.record(r.resolution, ['kind', 'sourceRef', ...(kind === 'declined' ? ['reason'] : [])], 'entity resolution')
  const sourceRef = parseTtrpgOpenSourceRefV1(resolution.sourceRef)
  if (sourceRef.sessionKey !== plan.proposedRef.sessionKey || sourceRef.sequence <= plan.proposedRef.sequence
    || approvals.some(a => a.sourceRef.sequence >= sourceRef.sequence)
    || kind === 'materialized' && (approvals.length !== plan.requiredApprovals.length || approvals.some(a => a.decision !== 'approve'))) p.fail('实体提交缺少原计划的完整先前确认')
  return { plan, approvals, resolution: kind === 'materialized' ? { kind, sourceRef } : { kind, sourceRef, reason: p.text(resolution.reason, 'entity decline reason', 2000) } }
}
