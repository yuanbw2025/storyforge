/** Human F13 desk. Returns a recipient projection, never the internal plan or frozen GM source. */
import type { WorkspaceScope } from '../types'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { isTtrpgOpenPassiveEpochV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { ttrpgOpenEntityIdentityCatalogV1, ttrpgOpenEntityReferenceVisibleV1 } from './open-entity-catalog'
import { countTtrpgOpenEntityInstancesV1 } from './open-entity-mechanics'
import { ttrpgItemDefinitionFromRuleV1 } from './item-ledger'
import type { TtrpgOpenEntityProposalV1 } from './open-entity-contract'
import { startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, consultTtrpgOracleV1, proposeTtrpgOpenEntitiesV1,
  confirmTtrpgOpenEntityOperationV1, materializeTtrpgOpenEntityV1, disposeTtrpgOpenEntityOperationV1, ttrpgOpenOperationCommandIdV1 } from './runtime-commands'

export interface TtrpgOpenEntityDeskInputV1 { scope: WorkspaceScope; sessionId: number; viewerKey: string }
async function load(input: TtrpgOpenEntityDeskInputV1) {
  return loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
}
function submission(value: string) {
  if (!/^[a-zA-Z0-9._-]{1,96}$/.test(value)) throw new Error('本次操作标识无效，请重新读取进度。')
  return value
}
function envelope(input: TtrpgOpenEntityDeskInputV1, loaded: Awaited<ReturnType<typeof load>>, commandId: string) {
  return { sessionId: input.sessionId, viewerKey: input.viewerKey, commandId, baseSequence: loaded.state.lastSequence, baseStateHash: loaded.stateHash }
}
function saved(event: { sequence: number }) { return { sequence: event.sequence } }
function projection(loaded: Awaited<ReturnType<typeof load>>, input: TtrpgOpenEntityDeskInputV1) {
  const { runtime, content, state, authorization: auth, seat, humanHost } = loaded, run = runtime.openRun!, gm = seat?.role === 'gm'
  const visible = (audience: 'public' | 'party' | 'private' | 'gm-only', recipients: string[], dynamic = true) =>
    ttrpgOpenEntityReferenceVisibleV1(audience, recipients, seat?.actorKey ?? null, gm, dynamic)
  const catalog = ttrpgOpenEntityIdentityCatalogV1(content, run.entityOperations ?? [])
  const placements = catalog.filter(row => row.kind !== 'item' && state.entities[row.entityKey]?.lifecycleStatus === 'active'
    && visible(row.audience, row.recipientActorKeys, row.dynamic)
    && (row.kind !== 'actor' || !content.campaign.characterTemplates.some(c => c.characterKey === row.entityKey && c.role === 'player') || auth.selectedActorKeys.includes(row.entityKey)))
    .map(row => ({ key: row.entityKey, kind: row.kind, name: state.entities[row.entityKey].name }))
  const templates = humanHost ? content.campaign.dynamicEntityTemplates.filter(t => visible(t.audience, t.knownByActorKeys, false)).map(t => ({
    key: t.templateKey, kind: t.kind, description: t.description, maximumNameLength: t.maximumNameLength,
    remaining: Math.max(0, t.maximumInstances - (run.entityOperations ?? []).filter(o => o.resolution?.kind === 'materialized').reduce((n, o) => n + o.plan.items.filter(i => i.proposal.templateKey === t.templateKey).length, 0)),
    parameters: t.parameters.map(p => ({ key: p.parameterKey, required: p.required, values: [...p.allowedValues] })),
    instanceCost: countTtrpgOpenEntityInstancesV1(content, [{ templateKey: t.templateKey, name: 'preview', description: 'preview', parameters: {}, locationRef: null, ownerRef: null }]),
  })) : []
  const epoch = run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)
  const ownWindow = Boolean(epoch && epoch.viewerKey === input.viewerKey && !isTtrpgOpenPassiveEpochV1(epoch))
  const active = runtime.product.safety.status === 'active' && run.stage.status === 'open'
  const idle = !epoch?.manualAction && !(epoch?.hostingDelegation && !epoch.hostingDelegation.stoppedRef)
    && !run.operations.some(o => ['awaiting-approval', 'executing'].includes(o.status))
    && !run.coordination.calls.some(c => c.authorizationEpochKey === epoch?.epochKey && ['prepared', 'dispatched', 'unknown'].includes(c.status))
    && !runtime.branchLineage?.recoveryTasks.some(t => !['completed', 'withdrawn'].includes(t.status))
  const pending = run.entityOperations?.find(o => !o.resolution)
  const hasUnadoptedEntityModelRequest = Boolean(ownWindow && run.coordination.calls.some(c => c.entityProposal
    && c.authorizationEpochKey === epoch?.epochKey && !run.entityOperations?.some(o => o.plan.version === 2 && o.plan.modelOrigin.call.requestKey === c.requestKey)))
  const ownApproval = pending?.plan.requiredApprovals.filter(a => a.allowedSeatKeys.includes(seat!.seatKey)) ?? []
  const mayReadPending = Boolean(pending && (pending.plan.viewerKey === input.viewerKey || ownApproval.length))
  const plan = pending?.plan
  const mechanicalImpact = (proposal: TtrpgOpenEntityProposalV1) => {
    const template = content.campaign.dynamicEntityTemplates.find(t => t.templateKey === proposal.templateKey)!
    if (template.kind === 'location') return ['建立一个本局地点；不移动角色，不增加世界时间。']
    if (template.kind === 'actor') return [`依冻结 NPC 规则初始化，含 ${countTtrpgOpenEntityInstancesV1(content, [proposal]) - 1} 件初始装备；不增加玩家席位。`]
    const definition = ttrpgItemDefinitionFromRuleV1(content.rulePack.content.items.find(i => i.key === template.itemDefinitionKey)!)
    return [`冻结物品定义：${definition.title}；数量：1。`, definition.publicDescription,
      `重量：${definition.weight ?? '未设定'}；初始充能：${definition.maximumCharges ?? '不适用'}；初始耐久：${definition.maximumDurability ?? '不适用'}。`,
      '仅放入指定库存或地点；不会自动使用、装备、绑定或扣除角色资源。']
  }
  const pendingView = pending && plan && mayReadPending ? {
    operationKey: plan.operationKey, planHash: plan.planHash, originalHost: plan.viewerKey === input.viewerKey,
    origin: plan.version === 2 ? 'model' as const : 'human' as const,
    items: plan.items.filter(i => plan.viewerKey === input.viewerKey || ownApproval.some(a => a.actorKey === i.proposal.ownerRef)).map(i => ({
      kind: i.kind, name: i.proposal.name, description: i.proposal.description,
      placement: i.proposal.ownerRef ? '加入' + (placements.find(p => p.key === i.proposal.ownerRef)?.name ?? '本人') + '的库存'
        : i.proposal.locationRef ? '位于' + (placements.find(p => p.key === i.proposal.locationRef)?.name ?? '已授权地点') : '建立独立地点',
      instanceCost: countTtrpgOpenEntityInstancesV1(content, [i.proposal]),
      impact: mechanicalImpact(i.proposal),
      parameters: Object.entries(i.proposal.parameters).map(([name, value]) => ({ name, value })),
    })),
    approvals: ownApproval.map(a => ({ actorKey: a.actorKey, name: a.actorKey === 'gm' ? '主持' : state.entities[a.actorKey]?.name ?? '本人角色',
      decision: pending.approvals.find(p => p.actorKey === a.actorKey)?.decision ?? null })),
    approved: pending.approvals.filter(a => a.decision === 'approve' && (plan.viewerKey === input.viewerKey || ownApproval.some(own => own.actorKey === a.actorKey))).length,
    required: plan.viewerKey === input.viewerKey ? plan.requiredApprovals.length : ownApproval.length,
    rejected: pending.approvals.some(a => a.decision === 'reject' && (plan.viewerKey === input.viewerKey || ownApproval.some(own => own.actorKey === a.actorKey))),
    canConfirm: active && idle,
    canMaterialize: active && idle && ownWindow && plan.viewerKey === input.viewerKey && pending.approvals.length === plan.requiredApprovals.length && pending.approvals.every(a => a.decision === 'approve'),
    canDispose: plan.viewerKey === input.viewerKey || pending.approvals.some(a => a.viewerKey === input.viewerKey && a.decision === 'reject'),
  } : null
  const oracles = humanHost ? (run.oracleReceipts ?? []).filter(o => ownWindow && o.viewerKey === input.viewerKey && o.authorizationEpochKey === epoch?.epochKey && (gm || o.audience !== 'gm-only')).map(o => {
    const table = content.rulePack.content.oracles.find(t => t.oracleKey === o.resolution.outcome.oracleKey)!, result = o.resolution.outcome.rawResult
    const used = (run.entityOperations ?? []).filter(op => op.resolution?.kind === 'materialized' && op.plan.oracleSourceRef.sessionKey === o.sourceRef.sessionKey && op.plan.oracleSourceRef.sequence === o.sourceRef.sequence)
      .reduce((n, op) => n + countTtrpgOpenEntityInstancesV1(content, op.plan.items.map(i => i.proposal)), 0)
    return { sourceRef: o.sourceRef, question: o.resolution.outcome.question,
      result: typeof result === 'string' ? ({ yes: '是', 'yes-but': '是，但是…', 'no-but': '否，但是…', no: '否' }[result]) : table.entries?.find(e => e.entryKey === result.entryKey)?.text ?? '原结果已保存',
      remaining: Math.max(0, table.interpretation.maxNewEntities - used), constraints: [...table.interpretation.mustRespect] }
  }) : []
  return { sequence: state.lastSequence, host: humanHost, paused: !active, ownWindow, hasUnadoptedEntityModelRequest,
    canStart: humanHost && templates.some(t => t.remaining > 0) && active && idle && !epoch && !pending,
    canConsult: humanHost && templates.some(t => t.remaining > 0) && active && idle && ownWindow && !pending && run.consultedThisWorldTurn < 2,
    canPropose: humanHost && active && idle && ownWindow && !pending && oracles.some(o => o.remaining > 0) && templates.some(t => t.remaining > 0),
    canClose: humanHost && ownWindow && idle && !pending,
    tables: humanHost ? content.rulePack.content.oracles.filter(t => gm || t.audience !== 'gm-only').map(t => ({ key: t.oracleKey, title: t.title,
      tiers: t.likelihood?.tiers.map(tier => ({ key: tier.tierKey, label: tier.label })) ?? [] })) : [],
    templates, placements: humanHost ? placements : [], oracles, pending: pendingView,
    entities: catalog.filter(e => e.dynamic && visible(e.audience, e.recipientActorKeys)).map(e => ({ key: e.entityKey, kind: e.kind,
      name: state.entities[e.entityKey].name, active: state.entities[e.entityKey].lifecycleStatus === 'active' })),
  }
}
export async function readTtrpgOpenEntityDeskV1(input: TtrpgOpenEntityDeskInputV1) {
  const loaded = await load(input), page = projection(loaded, input)
  await loaded.assertCurrent()
  return page.templates.length || page.pending || page.entities.length ? page : null
}
async function host(input: TtrpgOpenEntityDeskInputV1) {
  const loaded = await load(input)
  if (!loaded.humanHost) throw new Error('本次咨询和创建提案需要当前真人主持。')
  return { loaded, page: projection(loaded, input) }
}
export async function startTtrpgOpenEntityDeskV1(input: TtrpgOpenEntityDeskInputV1 & { submissionKey: string; decision: 'start-this-consultation' }) {
  if (input.decision !== 'start-this-consultation') throw new Error('请明确开始本次咨询。')
  const { loaded, page } = await host(input)
  if (!page.canStart) throw new Error('请先完成并结束当前窗口，或恢复冒险。')
  await loaded.assertCurrent()
  return startTtrpgOpenEpochV1({ ...envelope(input, loaded, 'entity.desk.start.' + submission(input.submissionKey)),
    triggerKind: loaded.seat!.role === 'gm' ? 'continue-host' : 'submit-action', rawInput: '真人明确开始模板内实体咨询与提案' }).then(saved)
}
export async function consultTtrpgOpenEntityDeskV1(input: TtrpgOpenEntityDeskInputV1 & { submissionKey: string; oracleKey: string; question: string; likelihoodTierKey: string | null }) {
  const { loaded, page } = await host(input)
  if (!page.canConsult || !page.tables.some(t => t.key === input.oracleKey)) throw new Error('当前不能进行新的咨询，请保留原结果并读取进度。')
  await loaded.assertCurrent()
  return consultTtrpgOracleV1({ ...envelope(input, loaded, 'entity.desk.oracle.' + submission(input.submissionKey)), oracleKey: input.oracleKey,
    question: input.question, likelihoodTierKey: input.likelihoodTierKey, askedBy: loaded.seat!.role === 'gm' ? 'gm' : `player:${loaded.seat!.actorKey!}` }).then(saved)
}
export async function proposeTtrpgOpenEntityDeskV1(input: TtrpgOpenEntityDeskInputV1 & { submissionKey: string; oracleSourceRef: TtrpgOpenSourceRefV1; proposals: TtrpgOpenEntityProposalV1[] }) {
  const { loaded, page } = await host(input)
  if (!page.canPropose) throw new Error('请先完成本次咨询并核对可用模板。')
  await loaded.assertCurrent()
  return proposeTtrpgOpenEntitiesV1({ ...envelope(input, loaded, 'entity.desk.propose.' + submission(input.submissionKey)), oracleSourceRef: input.oracleSourceRef, proposals: input.proposals }).then(saved)
}
async function operation(input: TtrpgOpenEntityDeskInputV1 & { operationKey: string; planHash: string }, step: string) {
  const loaded = await load(input), page = projection(loaded, input), pending = page.pending
  if (!pending || pending.operationKey !== input.operationKey || pending.planHash !== input.planHash) throw new Error('原待确认版本已经变化，请重新读取并审阅。')
  await loaded.assertCurrent()
  return { loaded, pending, command: { ...envelope(input, loaded, await ttrpgOpenOperationCommandIdV1(loaded.runtime.sessionKey, input.operationKey, step)), operationKey: input.operationKey, planHash: input.planHash } }
}
export async function confirmTtrpgOpenEntityDeskV1(input: TtrpgOpenEntityDeskInputV1 & { operationKey: string; planHash: string; actorKey: string; decision: 'approve' | 'reject'; review: 'reviewed-this-plan' }) {
  if (input.review !== 'reviewed-this-plan') throw new Error('请先审阅本版本对相关角色的影响。')
  const f = await operation(input, 'entity.approval.' + input.actorKey)
  if (!f.pending.canConfirm || !f.pending.approvals.some(a => a.actorKey === input.actorKey && !a.decision)) throw new Error('当前不能代替该角色确认。')
  return confirmTtrpgOpenEntityOperationV1({ ...f.command, actorKey: input.actorKey, decision: input.decision }).then(saved)
}
export async function materializeTtrpgOpenEntityDeskV1(input: TtrpgOpenEntityDeskInputV1 & { operationKey: string; planHash: string; decision: 'create-this-confirmed-plan' }) {
  if (input.decision !== 'create-this-confirmed-plan') throw new Error('请明确创建已确认的本次实体。')
  const f = await operation(input, 'entity.materialize')
  if (!f.pending.canMaterialize) throw new Error('请等待全部相关角色确认原计划。')
  return materializeTtrpgOpenEntityV1(f.command).then(saved)
}
export async function disposeTtrpgOpenEntityDeskV1(input: TtrpgOpenEntityDeskInputV1 & { operationKey: string; planHash: string; reason: string }) {
  const f = await operation(input, 'entity.dispose')
  if (!f.pending.canDispose) throw new Error('只有原主持或实际拒绝者可以放弃。')
  return disposeTtrpgOpenEntityOperationV1({ ...f.command, reason: input.reason }).then(saved)
}
export async function closeTtrpgOpenEntityDeskV1(input: TtrpgOpenEntityDeskInputV1 & { submissionKey: string }) {
  const { loaded, page } = await host(input)
  if (!page.canClose || page.hasUnadoptedEntityModelRequest) throw new Error('请先处置待确认计划、原 AI 请求与当前行动。')
  await loaded.assertCurrent()
  return closeTtrpgOpenEpochV1({ ...envelope(input, loaded, 'entity.desk.close.' + submission(input.submissionKey)), epochKey: loaded.runtime.openRun!.coordination.activeEpochKey!, reason: '真人明确结束本次咨询与实体提案' }).then(saved)
}
