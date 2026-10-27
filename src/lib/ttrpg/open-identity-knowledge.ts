/** Explicit semantic identity grants. Original F13 scope and all mechanical owners remain immutable. */
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenEntityOperationV1 } from './open-entity-contract'
import type { TtrpgOpenKnowledgeEntryV1 } from './open-knowledge'
import { parseTtrpgOpenKnowledgeEntryV1 } from './open-knowledge'
import { parseTtrpgOpenIdentityKnowledgeRequestV1, type TtrpgOpenIdentityKnowledgeRequestV1, type TtrpgOpenLearnedIdentityV1 } from './open-identity-knowledge-contract'
import { ttrpgOpenKnowledgeDiscoveryOriginV1, assertTtrpgOpenKnowledgeShareActorV1, createTtrpgOpenSharedKnowledgeV1, parseTtrpgOpenKnowledgeShareReceiptV1 } from './open-knowledge-share'
import { ttrpgOpenRuntimeEntityReferenceJournalRowsV1 } from './open-runtime-entity-references'
import { ttrpgOpenEntityReferenceVisibleV1 } from './open-entity-catalog'
import { assertTtrpgOpenSituationWindowEventV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'

export const ttrpgOpenIdentityKnowledgeEventV1 = (mode: TtrpgOpenIdentityKnowledgeRequestV1['mode']) => mode === 'observation'
  ? 'ttrpg.open.knowledge.identity-confirmed' as const : 'ttrpg.open.knowledge.identity-shared' as const

/** Ancestor sequences are local to their own journal, never globally comparable numbers. */
export function ttrpgOpenIdentitySourceBeforeV1(runtime: TtrpgRuntimeStateV2, a: TtrpgOpenSourceRefV1, b: TtrpgOpenSourceRefV1): boolean {
  const ancestors = runtime.branchLineage?.ancestors ?? [], keys = [...ancestors.map(row => row.sessionKey), runtime.sessionKey]
  const ai = keys.indexOf(a.sessionKey), bi = keys.indexOf(b.sessionKey)
  return ai >= 0 && bi >= 0 && (ai < bi || ai === bi && a.sequence < b.sequence)
    && (ai === ancestors.length || a.sequence <= ancestors[ai].throughSequence)
    && (bi === ancestors.length || b.sequence <= ancestors[bi].throughSequence)
}
const readable = (row: TtrpgOpenKnowledgeEntryV1, actor: string) => row.audience !== 'gm-only' && (row.audience === 'public' || row.recipientActorKeys.includes(actor))

/** Per-read index only. Mutable heads and lookalike imported records never share a cached authority. */
export function ttrpgOpenIdentityNamesFromJournalV1(operations: readonly TtrpgOpenEntityOperationV1[], runtimeSourceHash: string) {
  p.unique(operations.map(row => row.plan.operationKey), 'original identity operation keys')
  const byOperation = new Map(operations.map(row => [row.plan.operationKey, row]))
  const content = new Map<string, TtrpgRuntimeContentV2>()
  return ttrpgOpenRuntimeEntityReferenceJournalRowsV1(operations, runtimeSourceHash).map(row => {
    const op = byOperation.get(row.operationKey)!, item = op.plan.items.find(item => item.entityKey === row.entityRef)
    let name = item?.proposal.name
    if (!name) {
      let frozen = content.get(row.operationKey)
      if (!frozen) { frozen = JSON.parse(op.plan.frozenContentJson) as TtrpgRuntimeContentV2; content.set(row.operationKey, frozen) }
      name = frozen.rulePack.content.items.find(item => item.key === row.templateKey)?.name
    }
    if (!name) p.fail('原实际创建的实例缺少准确名称')
    return { ...row, name, rulePackContentHash: op.plan.rulePackContentHash }
  })
}

export function assertTtrpgOpenIdentityKnowledgeWindowV1(runtime: TtrpgRuntimeStateV2, viewerKey: string, mode: TtrpgOpenIdentityKnowledgeRequestV1['mode']) {
  const run = runtime.openRun, auth = runtime.authorization, seat = auth?.seats.find(row => row.viewerKey === viewerKey)
  const epoch = run?.coordination.epochs.find(row => row.epochKey === run.coordination.activeEpochKey)
  if (!run || !auth || !runtime.product.sessionZero.completed || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed'
    || !epoch || epoch.status !== 'active' || epoch.viewerKey !== viewerKey
    || runtime.product.safety.status !== 'active' || run.stage.status !== 'open') p.fail('身份知识需要本人有效开团授权、当前窗口且团局未暂停')
  assertTtrpgOpenSituationWindowEventV1(runtime, ttrpgOpenIdentityKnowledgeEventV1(mode))
  if (run.operations.some(row => ['awaiting-approval', 'executing'].includes(row.status))
    || run.coordination.calls.some(row => ['prepared', 'dispatched'].includes(row.status))
    || run.entityOperations?.some(row => row.resolution === null)
    || runtime.branchLineage?.recoveryTasks.some(row => !['completed', 'withdrawn'].includes(row.status))) p.fail('请先完成本轮原结算、请求或恢复，再确认身份知识')
  return { run, auth, seat, epoch }
}
export function ttrpgOpenIdentityKnowledgeSelectionV1(input: { runtime: TtrpgRuntimeStateV2; runtimeSourceHash: string; viewerKey: string;
  request: TtrpgOpenIdentityKnowledgeRequestV1; acquisitionRef: TtrpgOpenSourceRefV1 }) {
  const request = parseTtrpgOpenIdentityKnowledgeRequestV1(input.request), { run, auth, seat, epoch } = assertTtrpgOpenIdentityKnowledgeWindowV1(input.runtime, input.viewerKey, request.mode)
  const source = run.knowledge.find(row => row.knowledgeKey === request.sourceKnowledgeKey) ?? p.fail('身份知识必须来自真实已获得线索')
  const origin = ttrpgOpenKnowledgeDiscoveryOriginV1(input.runtime, source), content = origin.frozenContent
  if (!ttrpgOpenIdentitySourceBeforeV1(input.runtime, source.acquisitionRef, input.acquisitionRef) || source.audience === 'gm-only'
    || request.recipientActorKeys.some(key => !auth.selectedActorKeys.includes(key))
    || request.audience === 'party' && stable([...request.recipientActorKeys].sort()) !== stable([...auth.selectedActorKeys].sort())
    || request.audience === 'private' && !content.campaign.informationPolicy.interPlayerWhispers
    || request.audience === 'public' && auth.seats.some(row => !row.consent.publicSharingAllowed)) p.fail('身份知识的来源、先后、私信或准确接收者未获授权')
  const rows = ttrpgOpenIdentityNamesFromJournalV1(run.entityOperations ?? [], input.runtimeSourceHash)
  const identities: TtrpgOpenLearnedIdentityV1[] = [...request.entityRefs].sort().map(entityRef => {
    const row = rows.find(row => row.entityRef === entityRef) ?? p.fail('身份知识不能引用未创建对象或静态冻结别名')
    const name = row.name
    if (row.rulePackContentHash !== content.rulePack.contentHash
      || !ttrpgOpenIdentitySourceBeforeV1(input.runtime, row.sourceRef, source.acquisitionRef)) p.fail('识别必须晚于原实际创建，名字来自原 F13 而非可变属性')
    if (request.mode === 'share') {
      if (!source.identityGrant?.identities.some(identity => identity.entityRef === entityRef && identity.name === name)) p.fail('只能明确传播原已识别的身份子集')
    } else if (seat.role !== 'gm' && !ttrpgOpenEntityReferenceVisibleV1(row.audience, row.recipientActorKeys, request.actorKey, false, true)
      && !run.knowledge.some(knowledge => knowledge.identityGrant && readable(knowledge, request.actorKey!)
        && ttrpgOpenIdentitySourceBeforeV1(input.runtime, knowledge.acquisitionRef, input.acquisitionRef)
        && knowledge.identityGrant.identities.some(identity => identity.entityRef === entityRef))) p.fail('玩家不能借绑定线索猜出尚未获知的隐藏身份')
    return { entityRef, kind: row.kind, name, sourceRef: row.sourceRef, operationKey: row.operationKey, planHash: row.planHash }
  })
  if (request.mode === 'observation') {
    if (source.identityGrant || source.reliability !== 'observed' || request.audience === 'public' && source.audience !== 'public'
      || request.recipientActorKeys.some(actor => !readable(source, actor))) p.fail('识别只能绑定原实际观察者，不能把转述变为本人发现')
    if (seat.role === 'gm') { if (request.actorKey !== null) p.fail('真人主持须以主持身份确认观察') }
    else if (seat.role !== 'player' || request.actorKey !== seat.actorKey || request.audience !== 'private'
      || stable(request.recipientActorKeys) !== stable([seat.actorKey])) p.fail('玩家只能确认本人已知身份，不能代其他观察者判断')
  } else assertTtrpgOpenKnowledgeShareActorV1(auth, input.viewerKey, request.actorKey!)
  return { request, source, identities, auth, epoch, content }
}

export function createTtrpgOpenIdentityKnowledgeV1(input: Parameters<typeof ttrpgOpenIdentityKnowledgeSelectionV1>[0] & {
  knowledgeKey: string; sourceKnowledgeHash: string; submissionKey: string; baseStateHash: string; confirmationHash: string
}): TtrpgOpenKnowledgeEntryV1 {
  const { request, source, identities, auth, epoch, content } = ttrpgOpenIdentityKnowledgeSelectionV1(input)
  const knowledge = request.mode === 'share' ? createTtrpgOpenSharedKnowledgeV1({ request: { ...request, actorKey: request.actorKey!, publicFieldsHash: source.publicFieldsHash }, source,
    authorization: auth, knowledgeKey: input.knowledgeKey, acquisitionRef: input.acquisitionRef, privateChannelsAllowed: content.campaign.informationPolicy.interPlayerWhispers })
    : { ...source, knowledgeKey: input.knowledgeKey, acquisitionRef: input.acquisitionRef, audience: request.audience, recipientActorKeys: request.recipientActorKeys }
  return parseTtrpgOpenKnowledgeEntryV1({ ...knowledge, identityGrant: { schema: 'storyforge.ttrpg-open-knowledge-identities', version: 1, mode: request.mode,
    runtimeSourceHash: input.runtimeSourceHash, rulePackContentHash: content.rulePack.contentHash, sourceKnowledgeKey: source.knowledgeKey,
    sourceAcquisitionRef: source.acquisitionRef, sourceKnowledgeHash: input.sourceKnowledgeHash, viewerKey: input.viewerKey, actorKey: request.actorKey,
    authorizationRef: auth.sourceRef, authorizationEpochKey: epoch.epochKey, submissionKey: input.submissionKey, baseStateHash: input.baseStateHash, confirmationHash: input.confirmationHash, identities } })
}
/** Canonical portable payload, also reconstructed from ancestor evidence after parent deletion. */
export function ttrpgOpenIdentityKnowledgePayloadV1(knowledge: TtrpgOpenKnowledgeEntryV1) {
  const grant = knowledge.identityGrant ?? p.fail('身份回执缺少版本化来源')
  const request: TtrpgOpenIdentityKnowledgeRequestV1 = { mode: grant.mode, actorKey: grant.actorKey, sourceKnowledgeKey: grant.sourceKnowledgeKey,
    entityRefs: grant.identities.map(row => row.entityRef), audience: knowledge.audience as TtrpgOpenIdentityKnowledgeRequestV1['audience'], recipientActorKeys: knowledge.recipientActorKeys }
  const shareReceipt = grant.mode === 'share' ? parseTtrpgOpenKnowledgeShareReceiptV1({ sourceKnowledgeKey: grant.sourceKnowledgeKey,
    sourceAcquisitionRef: grant.sourceAcquisitionRef, sharedByActorKey: grant.actorKey, viewerKey: grant.viewerKey, authorizationEpochKey: grant.authorizationEpochKey,
    confirmationHash: grant.confirmationHash, knowledge }) : null
  return { knowledge, shareReceipt, intent: { viewerKey: grant.viewerKey, request, submissionKey: grant.submissionKey, confirmationHash: grant.confirmationHash } }
}

/** Exact source links are necessary even for records loaded from a backup or a branch snapshot. */
export function assertTtrpgOpenIdentityKnowledgeJournalV1(runtime: TtrpgRuntimeStateV2): void {
  const run = runtime.openRun
  const entries = run?.knowledge.filter(row => row.identityGrant) ?? []
  if (!run || !entries.length) return
  const byKnowledge = new Map(run.knowledge.map(row => [row.knowledgeKey, row]))
  const journals = new Map<string, Map<string, ReturnType<typeof ttrpgOpenIdentityNamesFromJournalV1>[number]>>()
  for (const knowledge of entries) {
    const grant = knowledge.identityGrant!
    const source = byKnowledge.get(grant.sourceKnowledgeKey)
    const originRun = knowledge.acquisitionRef.sessionKey === runtime.sessionKey ? run
      : runtime.branchLineage?.ancestors.find(row => row.sessionKey === knowledge.acquisitionRef.sessionKey)?.snapshot.openRun
    const epoch = originRun?.coordination.epochs.find(row => row.epochKey === grant.authorizationEpochKey)
    if (!source || !originRun || !epoch || epoch.viewerKey !== grant.viewerKey
      || !ttrpgOpenIdentitySourceBeforeV1(runtime, epoch.startedRef, knowledge.acquisitionRef)
      || epoch.closedRef && !ttrpgOpenIdentitySourceBeforeV1(runtime, knowledge.acquisitionRef, epoch.closedRef)
      || !ttrpgOpenIdentitySourceBeforeV1(runtime, grant.authorizationRef, epoch.startedRef)
      || stable(source.acquisitionRef) !== stable(grant.sourceAcquisitionRef)
      || !ttrpgOpenIdentitySourceBeforeV1(runtime, source.acquisitionRef, knowledge.acquisitionRef)
      || source.evidenceRef !== knowledge.evidenceRef || source.publicFieldsHash !== knowledge.publicFieldsHash
      || stable(source.sourceFactRefs) !== stable(knowledge.sourceFactRefs) || stable(source.sourceResourceRefs) !== stable(knowledge.sourceResourceRefs)
      || grant.rulePackContentHash !== runtime.product.rulePackContentHash || knowledge.audience === 'gm-only') p.fail('身份知识缺少准确先前来源、原窗口或冻结字段')
    if (grant.mode === 'observation') {
      if (source.identityGrant || source.reliability !== 'observed' || knowledge.reliability !== 'observed'
        || knowledge.audience === 'public' && source.audience !== 'public'
        || knowledge.recipientActorKeys.some(actor => !readable(source, actor))) p.fail('身份识别不得制造新观察者或发现权限')
    } else if (!source.identityGrant || knowledge.reliability !== (source.reliability === 'belief' ? 'belief' : 'hearsay')
      || grant.actorKey === null || !readable(source, grant.actorKey)
      || !run.knowledgeShares?.some(receipt => stable(receipt.knowledge) === stable(knowledge))) p.fail('身份传播缺少原识别或准确转述回执')
    const journalKey = `${knowledge.acquisitionRef.sessionKey}:${grant.runtimeSourceHash}`
    let rows = journals.get(journalKey)
    if (!rows) { rows = new Map(ttrpgOpenIdentityNamesFromJournalV1(originRun.entityOperations ?? [], grant.runtimeSourceHash).map(row => [row.entityRef, row])); journals.set(journalKey, rows) }
    for (const identity of grant.identities) {
      const actual = rows.get(identity.entityRef)
      if (!actual || actual.kind !== identity.kind || actual.name !== identity.name || actual.operationKey !== identity.operationKey
        || actual.planHash !== identity.planHash || stable(actual.sourceRef) !== stable(identity.sourceRef)
        || !ttrpgOpenIdentitySourceBeforeV1(runtime, identity.sourceRef, source.acquisitionRef)
        || grant.mode === 'share' && !source.identityGrant?.identities.some(row => stable(row) === stable(identity))) p.fail('身份记录没有原准确创建、名称或先前识别来源')
    }
  }
}
