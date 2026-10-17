import { parseTtrpgOpenNarrationBindingV1, type TtrpgOpenNarrationBindingV1 } from './open-kp-binding'
import { parseTtrpgOpenEntityModelSelectionV1, type TtrpgOpenEntityModelSelectionV1 } from './open-entity-model-contract'
import { parseTtrpgOpenOracleRuntimeReferencePolicyV1, assertTtrpgOpenOracleRuntimeReferenceJournalV1,
  type TtrpgOpenOracleRuntimeReferencePolicyV1, parseTtrpgOpenNormalizationRuntimeReferencePolicyV1,
  assertTtrpgOpenNormalizationRuntimeReferenceOriginV1, type TtrpgOpenNormalizationRuntimeReferencePolicyV1 } from './open-runtime-entity-references'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
/** Persisted request lifecycle. Only a dispatched call may have an unknown external result. */
import type { TtrpgOpenEpochV1, TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { ttrpgOpenCommonOracleCallMarkerV1 } from './open-common-oracle-request'
export interface TtrpgOpenModelCallV1 {
  commonOracle?: { worldTurn: number; oracleSourceRef: TtrpgOpenSourceRefV1; basisHash: string; runtimeReferencePolicy?: TtrpgOpenOracleRuntimeReferencePolicyV1 }
  entityProposal?: TtrpgOpenEntityModelSelectionV1
  hostingDelegationRef?: TtrpgOpenSourceRefV1
  requestKey: string; authorizationEpochKey: string
  actorKey: string; admissionStateHash: string; visibilityHash: string; runtimeSourceHash: string
  skillId: string; runContractHash: string; inputManifestHash: string; requestHash: string
  stepId: string; attempt: number
  createdRef: TtrpgOpenSourceRefV1; dispatchRef: TtrpgOpenSourceRefV1 | null; terminalRef: TtrpgOpenSourceRefV1 | null
  status: 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'unknown'
  reservedInputTokens: number; reservedOutputTokens: number; reservedCostUsd: number
  providerRequestId: string | null; responseArtifactHash: string | null
  usage: { source: 'provider' | 'estimated' | 'unknown'; inputTokens: number | null; outputTokens: number | null; actualCostUsd: number | null } | null
  terminalReason: string | null
  intentRejection?: { sourceRef: TtrpgOpenSourceRefV1; candidateHash: string }
  narrationBinding?: TtrpgOpenNarrationBindingV1
  oracleInterpretation?: { worldTurn: number; oracleSourceRef: TtrpgOpenSourceRefV1; runtimeReferencePolicy?: TtrpgOpenOracleRuntimeReferencePolicyV1 }
  supportSlot?: { worldTurn: number; purpose: 'fact-normalize'; sourceRef: TtrpgOpenSourceRefV1; sourceHash: string; oracleSourceRef: TtrpgOpenSourceRefV1;
    runtimeReferencePolicy?: TtrpgOpenNormalizationRuntimeReferencePolicyV1 }
}
/** Closed source identity also applies to offline replay; local storage proof is checked by the command. */
export function assertTtrpgOpenCommonOracleCallOriginV1(runtime: Pick<TtrpgRuntimeStateV2, 'openRun'>, call: TtrpgOpenModelCallV1) {
  const grant = runtime.openRun?.coordination.epochs.find(row => row.epochKey === call.authorizationEpochKey)?.commonOracle
  if (!grant && !call.commonOracle) return
  if (!grant || !call.commonOracle || call.skillId !== 'prose.ttrpg-open-common-oracle-interpret' || call.actorKey !== 'gm'
    || call.requestKey !== grant.requestKey || call.runContractHash !== grant.run.contractHash || call.stepId !== 'ttrpg.open.common-oracle-interpret' || call.attempt !== 1
    || call.admissionStateHash !== grant.admissionStateHash || call.visibilityHash !== grant.basis.sourceVisibilityHash || call.runtimeSourceHash !== grant.basis.runtimeSourceHash
    || stable(call.commonOracle) !== stable(ttrpgOpenCommonOracleCallMarkerV1(grant))
    || call.reservedInputTokens > grant.basis.budget.maximumInputTokens || call.reservedOutputTokens !== grant.basis.budget.maximumOutputTokens
    || call.reservedCostUsd > grant.basis.budget.maximumCostUsd) p.fail('共同事实调用必须保留原本人窗口、原请求、准确来源与单次预算')
}
export function parseTtrpgOpenModelCallV1(value: unknown): TtrpgOpenModelCallV1 {
  const r = p.record(value, ['requestKey','authorizationEpochKey','actorKey','admissionStateHash','visibilityHash','runtimeSourceHash',
    'skillId','runContractHash','inputManifestHash','requestHash','stepId','attempt',
    'createdRef','dispatchRef','terminalRef','status','reservedInputTokens','reservedOutputTokens','reservedCostUsd',
    'providerRequestId','responseArtifactHash','usage','terminalReason',
    ...(Object.prototype.hasOwnProperty.call(value, 'commonOracle') ? ['commonOracle'] : []),
    ...(Object.prototype.hasOwnProperty.call(value, 'entityProposal') ? ['entityProposal'] : []),
    ...(Object.prototype.hasOwnProperty.call(value,'hostingDelegationRef') ? ['hostingDelegationRef'] : []),
    ...(Object.prototype.hasOwnProperty.call(value, 'oracleInterpretation') ? ['oracleInterpretation'] : []),
    ...(Object.prototype.hasOwnProperty.call(value, 'supportSlot') ? ['supportSlot'] : []),
    ...(Object.prototype.hasOwnProperty.call(value, 'narrationBinding') ? ['narrationBinding'] : []),
    ...(Object.prototype.hasOwnProperty.call(value, 'intentRejection') ? ['intentRejection'] : [])], 'model call')
  const commonOracle = Object.prototype.hasOwnProperty.call(r, 'commonOracle') ? (() => {
    const marker = p.record(r.commonOracle, ['worldTurn', 'oracleSourceRef', 'basisHash', ...(Object.prototype.hasOwnProperty.call(r.commonOracle, 'runtimeReferencePolicy') ? ['runtimeReferencePolicy'] : [])], 'common Oracle call source')
    return { worldTurn: p.integer(marker.worldTurn, 'common Oracle turn', 0), oracleSourceRef: parseTtrpgOpenSourceRefV1(marker.oracleSourceRef), basisHash: p.hash(marker.basisHash, 'common Oracle original basis'),
      ...(Object.prototype.hasOwnProperty.call(marker, 'runtimeReferencePolicy') ? { runtimeReferencePolicy: parseTtrpgOpenOracleRuntimeReferencePolicyV1(marker.runtimeReferencePolicy) } : {}) }
  })() : undefined
  if ((r.skillId === 'prose.ttrpg-open-common-oracle-interpret') !== Boolean(commonOracle)) p.fail('共同事实调用必须绑定本次原共同来源，其他用途不能借用')
  const narrationBinding = Object.prototype.hasOwnProperty.call(r, 'narrationBinding') ? parseTtrpgOpenNarrationBindingV1(r.narrationBinding) : undefined
  const entityProposal = Object.prototype.hasOwnProperty.call(r, 'entityProposal') ? parseTtrpgOpenEntityModelSelectionV1(r.entityProposal) : undefined
  if ((r.skillId === 'prose.ttrpg-open-entity-propose') !== Boolean(entityProposal)) p.fail('实体模型请求必须冻结原咨询和单一范围，其他用途不能借用')
  if ((r.skillId === 'prose.ttrpg-open-kp') !== Boolean(narrationBinding)) p.fail('KP 必须绑定实际叙述步骤，其他目的不能占用')
  const supportSlot = Object.prototype.hasOwnProperty.call(r,'supportSlot') ? (() => {
    const hasPolicy = Object.prototype.hasOwnProperty.call(r.supportSlot, 'runtimeReferencePolicy')
    const slot = p.record(r.supportSlot,['worldTurn','purpose','sourceRef','sourceHash','oracleSourceRef', ...(hasPolicy ? ['runtimeReferencePolicy'] : [])],'semantic assistance slot')
    return { worldTurn: p.integer(slot.worldTurn,'assistance worldTurn',0,Number.MAX_SAFE_INTEGER),
      purpose: p.literal(slot.purpose,'fact-normalize','assistance purpose'),sourceRef: parseTtrpgOpenSourceRefV1(slot.sourceRef),
      sourceHash: p.hash(slot.sourceHash,'assistance accepted review hash'),oracleSourceRef: parseTtrpgOpenSourceRefV1(slot.oracleSourceRef),
      ...(hasPolicy ? { runtimeReferencePolicy: parseTtrpgOpenNormalizationRuntimeReferencePolicyV1(slot.runtimeReferencePolicy) } : {}) }
  })() : undefined
  if ((r.skillId === 'prose.ttrpg-open-fact-normalize') !== (supportSlot !== undefined)) p.fail('事实归一必须绑定唯一辅助槽和已确认来源，其他调用不能占用')
  const oracleInterpretation = Object.prototype.hasOwnProperty.call(r, 'oracleInterpretation') ? (() => {
    const hasPolicy = Object.prototype.hasOwnProperty.call(r.oracleInterpretation, 'runtimeReferencePolicy')
    const marker = p.record(r.oracleInterpretation, ['worldTurn', 'oracleSourceRef', ...(hasPolicy ? ['runtimeReferencePolicy'] : [])], 'Oracle interpretation slot')
    return { worldTurn: p.integer(marker.worldTurn, 'Oracle interpretation worldTurn', 0, Number.MAX_SAFE_INTEGER),
      oracleSourceRef: parseTtrpgOpenSourceRefV1(marker.oracleSourceRef),
      ...(hasPolicy ? { runtimeReferencePolicy: parseTtrpgOpenOracleRuntimeReferencePolicyV1(marker.runtimeReferencePolicy) } : {}) }
  })() : undefined
  if ((r.skillId === 'prose.ttrpg-open-oracle-interpret') !== (oracleInterpretation !== undefined)) p.fail('Oracle 解释必须绑定唯一世界轮槽位，其他调用不能占用')
  const createdRef = parseTtrpgOpenSourceRefV1(r.createdRef)
  const hostingDelegationRef = Object.prototype.hasOwnProperty.call(r,'hostingDelegationRef') ? parseTtrpgOpenSourceRefV1(r.hostingDelegationRef) : undefined
  if (hostingDelegationRef && (!['prose.ttrpg-open-companion','prose.ttrpg-open-kp'].includes(String(r.skillId))
    || hostingDelegationRef.sessionKey !== createdRef.sessionKey || hostingDelegationRef.sequence >= createdRef.sequence)) p.fail('有限主持请求必须引用更早的本窗口委托，不能扩展用途')
  const dispatchRef = r.dispatchRef === null ? null : parseTtrpgOpenSourceRefV1(r.dispatchRef)
  const terminalRef = r.terminalRef === null ? null : parseTtrpgOpenSourceRefV1(r.terminalRef)
  const status = p.oneOf(r.status, ['prepared','dispatched','succeeded','failed','unknown'], 'call status')
  const terminal = ['succeeded','failed','unknown'].includes(status)
  const responseArtifactHash = p.nullable(r.responseArtifactHash, p.hash, 'raw response artifact')
  const terminalReason = p.nullable(r.terminalReason, (v,l) => p.text(v,l,2000), 'terminal reason')
  const usage = r.usage === null ? null : (() => {
    const u = p.record(r.usage, ['source','inputTokens','outputTokens','actualCostUsd'], 'call usage')
    return { source: p.oneOf(u.source, ['provider','estimated','unknown'], 'usage source'),
      inputTokens: p.nullable(u.inputTokens, (v,l) => p.integer(v,l,0,Number.MAX_SAFE_INTEGER), 'input usage'),
      outputTokens: p.nullable(u.outputTokens, (v,l) => p.integer(v,l,0,Number.MAX_SAFE_INTEGER), 'output usage'),
      actualCostUsd: p.nullable(u.actualCostUsd, (v,l) => p.number(v,l,0,1_000_000), 'actual cost') }
  })()
  if (terminal !== (terminalRef !== null) || terminal !== (usage !== null) || terminal !== (terminalReason !== null)
    || (status === 'prepared' && dispatchRef !== null) || (['dispatched','succeeded','unknown'].includes(status) && dispatchRef === null)
    || (status === 'succeeded' && responseArtifactHash === null)
    || (!terminal && responseArtifactHash !== null)
    || (status === 'prepared' && r.providerRequestId !== null)
    || (status === 'failed' && dispatchRef === null && (terminalReason !== 'cancelled-before-dispatch'
      || usage?.inputTokens !== 0 || usage.outputTokens !== 0 || usage.actualCostUsd !== 0 || responseArtifactHash !== null))
    || [dispatchRef,terminalRef].some(ref => ref !== null && (ref.sessionKey !== createdRef.sessionKey || ref.sequence <= createdRef.sequence))
    || (dispatchRef && terminalRef && terminalRef.sequence <= dispatchRef.sequence)
    || (status === 'unknown' && (responseArtifactHash !== null || usage?.source !== 'unknown' || usage.inputTokens !== null || usage.outputTokens !== null || usage.actualCostUsd !== null))
    || (usage && usage.source !== 'unknown' && (usage.inputTokens === null || usage.outputTokens === null))) p.fail('模型调用的派发/终态/原始响应/用量证据不一致')
  const intentRejection = r.intentRejection === undefined ? undefined : (() => {
    const row = p.record(r.intentRejection, ['sourceRef', 'candidateHash'], 'intent rejection'), sourceRef = parseTtrpgOpenSourceRefV1(row.sourceRef)
    if (!['prose.ttrpg-open-intent', 'prose.ttrpg-open-companion'].includes(String(r.skillId)) || status !== 'succeeded' || sourceRef.sessionKey !== createdRef.sessionKey || !terminalRef || sourceRef.sequence <= terminalRef.sequence) p.fail('拒绝必须来自实际角色候选终态之后')
    return { sourceRef, candidateHash: p.hash(row.candidateHash, 'rejected intent candidate') }
  })()
  return { ...(commonOracle ? { commonOracle } : {}), requestKey: p.key(r.requestKey, 'requestKey'), authorizationEpochKey: p.key(r.authorizationEpochKey, 'call epoch'),
    actorKey: p.key(r.actorKey, 'call actor'), admissionStateHash: p.hash(r.admissionStateHash, 'call admission'),
    visibilityHash: p.hash(r.visibilityHash, 'call visibility'), runtimeSourceHash: p.hash(r.runtimeSourceHash, 'call source'),
    skillId: p.key(r.skillId, 'call Skill'), runContractHash: p.hash(r.runContractHash, 'run contract'), inputManifestHash: p.hash(r.inputManifestHash, 'input manifest'),
    requestHash: p.hash(r.requestHash, 'request hash'), stepId: p.key(r.stepId, 'step'), attempt: p.integer(r.attempt, 'attempt',1,4),
    createdRef, dispatchRef, terminalRef, status, reservedInputTokens: p.integer(r.reservedInputTokens, 'reserved input',0,1_000_000),
    reservedOutputTokens: p.integer(r.reservedOutputTokens, 'reserved output',1,100_000), reservedCostUsd: p.number(r.reservedCostUsd, 'reserved cost',0,1000),
    providerRequestId: p.nullable(r.providerRequestId, (v,l) => p.text(v,l,500), 'provider request ID'), responseArtifactHash, usage, terminalReason,
    ...(entityProposal ? { entityProposal } : {}), ...(hostingDelegationRef ? { hostingDelegationRef } : {}),...(oracleInterpretation ? { oracleInterpretation } : {}),...(supportSlot ? { supportSlot } : {}), ...(narrationBinding ? { narrationBinding } : {}), ...(intentRejection ? { intentRejection } : {}) }
}
/** The new call scope must be the exact original epoch policy; historical V1 never acquires it. */
export function assertTtrpgOpenOracleRuntimeCallOriginV1(runtime: Pick<TtrpgRuntimeStateV2, 'openRun' | 'product'>, call: TtrpgOpenModelCallV1) {
  const epoch = runtime.openRun?.coordination.epochs.find(row => row.epochKey === call.authorizationEpochKey)
  const policy = call.oracleInterpretation?.runtimeReferencePolicy
  if (!policy && !epoch?.oracleRuntimeReferencePolicy) return
  const oracle = runtime.openRun?.oracleReceipts?.find(row => stable(row.sourceRef) === stable(call.oracleInterpretation?.oracleSourceRef))
  if (!epoch || !policy || !oracle || call.skillId !== 'prose.ttrpg-open-oracle-interpret'
    || stable(policy) !== stable(epoch.oracleRuntimeReferencePolicy) || stable(policy.oracleSourceRef) !== stable(oracle.sourceRef)) p.fail('实例事实调用没有原窗口、原 Oracle 和准确读取策略')
  assertTtrpgOpenOracleRuntimeReferenceJournalV1({ policy, operations: runtime.openRun!.entityOperations ?? [], oracle,
    recipientActorKeys: policy.recipientActorKeys, runtimeSourceHash: call.runtimeSourceHash, rulePackContentHash: runtime.product.rulePackContentHash,
    consumerRef: epoch.startedRef })
}
export function assertTtrpgOpenSupportSlotV1(runtime: Pick<TtrpgRuntimeStateV2,'openRun'|'branchLineage'>,worldTurn: number): void {
  const calls = [...(runtime.openRun?.coordination.calls ?? []),
    ...(runtime.branchLineage?.ancestors.flatMap(ancestor => ancestor.snapshot.openRun?.coordination.calls ?? []) ?? [])]
  if (calls.some(call => call.supportSlot?.worldTurn === worldTurn)) p.fail('每个 worldTurn 最多占用一次征兆/事实归一辅助槽，请复用已有候选')
}
export function assertTtrpgOpenEntityModelCallOriginV1(runtime: TtrpgRuntimeStateV2, call: TtrpgOpenModelCallV1): void {
  if (!call.entityProposal) return
  const selection = call.entityProposal, run = runtime.openRun
  const epoch = run?.coordination.epochs.find(e => e.epochKey === call.authorizationEpochKey)
  const oracle = run?.oracleReceipts?.find(o => o.sourceRef.sessionKey === selection.oracleSourceRef.sessionKey && o.sourceRef.sequence === selection.oracleSourceRef.sequence)
  if (!epoch || epoch.status !== 'active' || run?.coordination.activeEpochKey !== epoch.epochKey || epoch.manualAction
    || epoch.hostingDelegation && !epoch.hostingDelegation.stoppedRef || epoch.inputRevision !== selection.epochInputRevision
    || call.actorKey !== 'gm' || !oracle || oracle.viewerKey !== epoch.viewerKey || oracle.authorizationEpochKey !== epoch.epochKey
    || oracle.sourceRef.sessionKey !== runtime.sessionKey || oracle.sourceRef.sequence >= call.createdRef.sequence
    || oracle.audience === 'gm-only' && selection.scope.audience !== 'gm-only'
    || oracle.audience !== 'public' && selection.scope.audience === 'public') p.fail('模型实体提案缺少同一原咨询、窗口及单一披露范围')
}
export function assertTtrpgOpenNormalizationSourceV1(runtime: Pick<TtrpgRuntimeStateV2,'openRun' | 'branchLineage' | 'sessionKey' | 'product'>,call: TtrpgOpenModelCallV1): void {
  const epoch = runtime.openRun?.coordination.epochs.find(row => row.epochKey === call.authorizationEpochKey)
  const policy = call.supportSlot?.runtimeReferencePolicy
  if (policy || epoch?.normalizationRuntimeReferencePolicy) {
    if (!epoch || !policy || call.actorKey !== 'gm' || call.skillId !== 'prose.ttrpg-open-fact-normalize'
      || stable(policy) !== stable(epoch.normalizationRuntimeReferencePolicy)
      || stable(policy.reviewSourceRef) !== stable(call.supportSlot!.sourceRef) || policy.reviewHash !== call.supportSlot!.sourceHash
      || stable(policy.oraclePolicy.oracleSourceRef) !== stable(call.supportSlot!.oracleSourceRef)) p.fail('实例归一没有原窗口及原已接受解释的准确来源')
    assertTtrpgOpenNormalizationRuntimeReferenceOriginV1({ runtime, policy, runtimeSourceHash: call.runtimeSourceHash,
      rulePackContentHash: runtime.product.rulePackContentHash, reviewSourceRef: policy.reviewSourceRef,
      consumerRef: epoch.startedRef, recipientActorKeys: policy.recipientActorKeys })
    return
  }
  if (!call.supportSlot) return
  const slot = call.supportSlot
  const review = runtime.openRun?.oracleReviews?.find(review => review.sourceRef.sessionKey === slot.sourceRef.sessionKey && review.sourceRef.sequence === slot.sourceRef.sequence)
  if (!review || review.interpretationDecision !== 'accept' || review.normalizationOf || review.reviewHash !== slot.sourceHash
    || (slot.sourceRef.sessionKey === call.createdRef.sessionKey && slot.sourceRef.sequence >= call.createdRef.sequence)
    || review.oracleSourceRef.sessionKey !== slot.oracleSourceRef.sessionKey || review.oracleSourceRef.sequence !== slot.oracleSourceRef.sequence) p.fail('事实归一没有明确已接受的真实解释来源')
}
/** A semantic leaf can only use the instance proof actually delivered to its own versioned call. */
export function ttrpgOpenSemanticRuntimeReferencePolicyV1(call: TtrpgOpenModelCallV1) {
  return call.commonOracle?.runtimeReferencePolicy ?? call.oracleInterpretation?.runtimeReferencePolicy ?? call.supportSlot?.runtimeReferencePolicy?.oraclePolicy
}
export function assertTtrpgOpenSemanticCallOriginV1(call: TtrpgOpenModelCallV1,oracleSourceRef: TtrpgOpenSourceRefV1,
  normalizationOf?: { sourceRef: TtrpgOpenSourceRefV1;reviewHash: string }): void {
  const actual = call.commonOracle?.oracleSourceRef ?? call.oracleInterpretation?.oracleSourceRef ?? call.supportSlot?.oracleSourceRef
  if (!actual || actual.sessionKey !== oracleSourceRef.sessionKey || actual.sequence !== oracleSourceRef.sequence) p.fail('语义候选没有同一真实 Oracle 输入')
  if (call.skillId === 'prose.ttrpg-open-oracle-interpret' || call.skillId === 'prose.ttrpg-open-common-oracle-interpret') {
    if (normalizationOf) p.fail('原始解释不能冒充事实归一')
  } else if (call.skillId === 'prose.ttrpg-open-fact-normalize') {
    if (!call.supportSlot || !normalizationOf || normalizationOf.reviewHash !== call.supportSlot.sourceHash
      || normalizationOf.sourceRef.sessionKey !== call.supportSlot.sourceRef.sessionKey || normalizationOf.sourceRef.sequence !== call.supportSlot.sourceRef.sequence) p.fail('事实归一没有同一已确认解释来源')
  } else p.fail('此正式 Skill 无语义事实候选权限')
}

/** Reservations also consume the slot: cancellation, a new epoch or a branch cannot conceal a previous attempt. */
export function assertTtrpgOpenOracleInterpretationSlotV1(runtime: TtrpgRuntimeStateV2, worldTurn: number): void {
  const calls = [...(runtime.openRun?.coordination.calls ?? []),
    ...(runtime.branchLineage?.ancestors.flatMap(ancestor => ancestor.snapshot.openRun?.coordination.calls ?? []) ?? [])]
  if (calls.some(call => call.oracleInterpretation?.worldTurn === worldTurn || call.commonOracle?.worldTurn === worldTurn)) p.fail('每个 worldTurn 最多一次模型 Oracle 解释，请复用已有候选')
}

/** Ledger summaries are derived from actual call receipts, never accepted from a model. */
export function updateTtrpgOpenEpochCallTotalsV1(epoch: TtrpgOpenEpochV1, calls: readonly TtrpgOpenModelCallV1[]): void {
  const owned = calls.filter(call => call.authorizationEpochKey === epoch.epochKey)
  epoch.reservedCalls = owned.filter(call => call.status === 'prepared' || call.status === 'dispatched').length
  epoch.consumedTokens = owned.reduce((total, call) => total + (call.usage?.inputTokens ?? 0) + (call.usage?.outputTokens ?? 0), 0)
  epoch.actualCostUsd = owned.some(call => ['dispatched', 'succeeded', 'failed', 'unknown'].includes(call.status)
    && call.usage?.actualCostUsd == null) ? null : owned.reduce((total, call) => total + (call.usage?.actualCostUsd ?? 0), 0)
}
export function ttrpgOpenCallBudgetV1(epoch: TtrpgOpenEpochV1, calls: readonly TtrpgOpenModelCallV1[]) {
  const owned = calls.filter(call => call.authorizationEpochKey === epoch.epochKey)
  let tokens = 0, costUsd = 0
  for (const call of owned) {
    const uncertain = call.status === 'prepared' || call.status === 'dispatched' || call.status === 'unknown'
      || call.usage?.inputTokens === null || call.usage?.outputTokens === null
    tokens += uncertain ? call.reservedInputTokens + call.reservedOutputTokens : call.usage!.inputTokens! + call.usage!.outputTokens!
    costUsd += call.usage?.actualCostUsd ?? call.reservedCostUsd
  }
  return { countedRequests: owned.length, committedOrReservedTokens: tokens, committedOrReservedCostUsd: costUsd,
    blockedByUnknown: owned.some(call => call.status === 'unknown'),
    blockedByDenial: owned.some(call => call.status === 'failed' && call.terminalReason === 'provider-denied-no-retry'),
    pending: owned.some(call => call.status === 'prepared' || call.status === 'dispatched') }
}
export function assertTtrpgOpenCallReservationV1(input: {
  epoch: TtrpgOpenEpochV1; calls: readonly TtrpgOpenModelCallV1[]; requestKey: string
  inputTokens: number; outputTokens: number; maximumCostUsd: number
}): void {
  const tokens = p.integer(input.inputTokens,'input tokens',0,1_000_000) + p.integer(input.outputTokens,'output tokens',1,100_000)
  const cost = p.number(input.maximumCostUsd,'maximum request cost',0,1000)
  const budget = ttrpgOpenCallBudgetV1(input.epoch,input.calls)
  if (input.epoch.status !== 'active' || input.calls.some(call => call.requestKey === input.requestKey)
    || budget.blockedByUnknown || budget.blockedByDenial || budget.pending || budget.countedRequests >= input.epoch.budget.maximumCalls
    || budget.committedOrReservedTokens + tokens > input.epoch.budget.maximumTokens
    || budget.committedOrReservedCostUsd + cost > input.epoch.budget.maximumCostUsd) p.fail('模型请求缺少新授权/确定回执或剩余硬预算')
}

export function assertTtrpgOpenNarrationCallV1(runtime: TtrpgRuntimeStateV2, call: TtrpgOpenModelCallV1, mode: 'reserve' | 'dispatch' | 'finish') {
  if (!call.narrationBinding) return
  const n = call.narrationBinding, operation = runtime.openRun?.operations.find(o => o.operationKey === n.operationKey)
  const rule = runtime.openRun?.ruleReceipts.find(r => r.operationKey === n.operationKey), original = rule?.inheritedFrom?.originalSourceRef ?? rule?.sourceRef
  if (!operation || !rule || !original || operation.planHash !== n.frozenPlanHash || operation.authorizationEpochKey !== call.authorizationEpochKey
    || original.sessionKey !== n.ruleSourceRef.sessionKey || original.sequence !== n.ruleSourceRef.sequence || call.actorKey !== 'gm'
    || (mode !== 'finish' && (operation.status !== 'executing' || operation.businessRefs.some(r => r.stepKey === 'narration') || operation.plannedSteps[operation.receipts.length]?.kind !== 'narration'))) p.fail('KP 没有当前真实规则/检查后的叙述授权')
  if (mode === 'reserve' && runtime.openRun!.coordination.calls.some(c => c.narrationBinding?.operationKey === n.operationKey)) p.fail('本操作已经请求过 KP，请复用或修订已有候选，不得重发')
}
