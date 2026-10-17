import { parseTtrpgOpenCommonOracleArchiveReceiptV1, assertTtrpgOpenCommonOracleArchiveStateV1, type TtrpgOpenCommonOracleArchiveReceiptV1 } from './open-common-oracle-archive-contract'
import { parseTtrpgOpenCommonOracleAuthorizationV1, TTRPG_OPEN_COMMON_ORACLE_SKILL_V1, type TtrpgOpenCommonOracleAuthorizationV1 } from './open-common-oracle-request'
import { assertTtrpgOpenEntityWindowEventV1 } from './open-entity-window'
import type { TtrpgOpenManualActionAuthorizationV1 } from './open-manual-action'
import { parseTtrpgOpenModelCallV1, updateTtrpgOpenEpochCallTotalsV1, type TtrpgOpenModelCallV1 } from './open-model-calls'
/** Durable authority windows are independent of game time and event ordering. */
import type { TtrpgCampaignContentV2 } from './open-contract'
import { assertTtrpgOpenHumanHostV1, type TtrpgOpenAuthorizationV1 } from './open-authorization'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import type { TtrpgOpenBranchLineageV1 } from './open-branch-contract'
import type { ProductRuntimeEvent } from '../types'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { hash, integer, key, list, number, record, text } from './open-contract-parse'
import { parseTtrpgOpenPublicSituationAuthorizationV1, type TtrpgOpenPublicSituationAuthorizationV1,
  TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1, TTRPG_OPEN_PUBLIC_SITUATION_SKILL_V1 } from './open-public-situation-authorization-contract'
import { parseTtrpgOpenSituationRuntimeReferencePolicyV1, type TtrpgOpenSituationRuntimeReferencePolicyV1,
  parseTtrpgOpenOracleRuntimeReferencePolicyV1, type TtrpgOpenOracleRuntimeReferencePolicyV1,
  parseTtrpgOpenNormalizationRuntimeReferencePolicyV1, type TtrpgOpenNormalizationRuntimeReferencePolicyV1 } from './open-runtime-entity-references'

export interface TtrpgOpenSourceRefV1 { sessionKey: string; sequence: number }
/** Pure source-ref matching; hashing/capturing lineage stays outside the state chunk. */
export function ttrpgOpenAncestorSourceAllowedV1(lineage: TtrpgOpenBranchLineageV1 | undefined,
  sourceRef: TtrpgOpenSourceRefV1, allowedTypes?: readonly ProductRuntimeEvent['type'][]): boolean {
  const ancestor = lineage?.ancestors.find(a => a.sessionKey === sourceRef.sessionKey)
  const event = ancestor?.events[sourceRef.sequence - 1]
  return !!event && event.sourceRef.sequence === sourceRef.sequence && (!allowedTypes || allowedTypes.includes(event.type))
}
export const TTRPG_OPEN_ORACLE_INSTANCE_INPUT_V1 = '明确解释已选的原 Oracle；仅用本次冻结并实际交付的对象身份拟定语义事实。'
export const TTRPG_OPEN_NORMALIZATION_INSTANCE_INPUT_V1 = '仅整理已选且已接受的原解释中的事实；原解释、弃用决定和原创建范围保持不变。'
export const TTRPG_OPEN_HOSTING_CAPABILITIES_V1 = ['companion-proposal','safe-companion-action','kp-narration'] as const
export interface TtrpgOpenHostingDelegationV1 {
  schema: 'storyforge.ttrpg-open-hosting-delegation';version: 1
  epochKey: string;viewerKey: string;sourceRef: TtrpgOpenSourceRefV1;authorizationRef: TtrpgOpenSourceRefV1
  capabilities: typeof TTRPG_OPEN_HOSTING_CAPABILITIES_V1
  maximumCostUsdPerCall: number;stoppedRef: TtrpgOpenSourceRefV1 | null;stopReason: string | null
}
export interface TtrpgOpenEpochBudgetV1 {
  maximumCalls: number
  maximumTokens: number
  maximumCostUsd: number
  maximumAiActions: number
}
export interface TtrpgOpenEpochV1 {
  commonOracle?: TtrpgOpenCommonOracleAuthorizationV1
  commonOracleArchive?: TtrpgOpenCommonOracleArchiveReceiptV1
  normalizationRuntimeReferencePolicy?: TtrpgOpenNormalizationRuntimeReferencePolicyV1
  oracleRuntimeReferencePolicy?: TtrpgOpenOracleRuntimeReferencePolicyV1
  runtimeEntityReferencePolicy?: TtrpgOpenSituationRuntimeReferencePolicyV1
  publicSituation?: TtrpgOpenPublicSituationAuthorizationV1
  manualAction?: TtrpgOpenManualActionAuthorizationV1
  hostingDelegation?: TtrpgOpenHostingDelegationV1
  epochKey: string
  startedRef: TtrpgOpenSourceRefV1
  closedRef: TtrpgOpenSourceRefV1 | null
  status: 'active' | 'closed'
  triggeredBySeatKey: string
  viewerKey: string
  triggerKind: 'submit-action' | 'continue-host' | 'request-brief' | 'request-situation' | 'request-public-situation'
  inputRevision: string
  sessionZeroRevision: number
  authorizationHash: string
  budget: TtrpgOpenEpochBudgetV1
  successfulActorKeys: string[]
  reservedCalls: number
  consumedTokens: number
  actualCostUsd: number | null
  stopReason: string | null
}
export interface TtrpgOpenCoordinationV1 {
  activeEpochKey: string | null
  epochs: TtrpgOpenEpochV1[]
  calls: TtrpgOpenModelCallV1[]
}

function fail(message: string): never { throw new Error(`[ttrpg-open-coordination] ${message}`) }
export function parseTtrpgOpenSourceRefV1(value: unknown): TtrpgOpenSourceRefV1 {
  const row = record(value, ['sessionKey', 'sequence'], 'sourceRef')
  return { sessionKey: key(row.sessionKey, 'sourceRef.sessionKey'),
    sequence: integer(row.sequence, 'sourceRef.sequence', 1, Number.MAX_SAFE_INTEGER) }
}
export function parseTtrpgOpenHostingDelegationV1(value: unknown): TtrpgOpenHostingDelegationV1 {
  const r = record(value,['schema','version','epochKey','viewerKey','sourceRef','authorizationRef','capabilities','maximumCostUsdPerCall','stoppedRef','stopReason'],'hosting delegation')
  if (r.schema !== 'storyforge.ttrpg-open-hosting-delegation' || r.version !== 1
    || JSON.stringify(r.capabilities) !== JSON.stringify(TTRPG_OPEN_HOSTING_CAPABILITIES_V1)) fail('有限主持委托能力不符合当前闭集')
  const sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef),authorizationRef = parseTtrpgOpenSourceRefV1(r.authorizationRef)
  const stoppedRef = r.stoppedRef === null ? null : parseTtrpgOpenSourceRefV1(r.stoppedRef)
  const stopReason = r.stopReason === null ? null : text(r.stopReason,'hosting stop reason',2000)
  if (sourceRef.sessionKey !== authorizationRef.sessionKey || sourceRef.sequence <= authorizationRef.sequence
    || Boolean(stoppedRef) !== Boolean(stopReason) || stoppedRef && (stoppedRef.sessionKey !== sourceRef.sessionKey || stoppedRef.sequence <= sourceRef.sequence)) fail('有限主持委托来源或停止回执不闭合')
  return { schema: 'storyforge.ttrpg-open-hosting-delegation',version: 1,epochKey: key(r.epochKey,'delegation epoch'),viewerKey: key(r.viewerKey,'delegating viewer'),
    sourceRef,authorizationRef,capabilities: [...TTRPG_OPEN_HOSTING_CAPABILITIES_V1],maximumCostUsdPerCall: number(r.maximumCostUsdPerCall,'hosting per-call budget',0,1000),stoppedRef,stopReason }
}
export function parseTtrpgOpenEpochBudgetV1(value: unknown): TtrpgOpenEpochBudgetV1 {
  const row = record(value, ['maximumCalls', 'maximumTokens', 'maximumCostUsd', 'maximumAiActions'], 'epoch budget')
  return {
    maximumCalls: integer(row.maximumCalls, 'maximumCalls', 0, 9),
    maximumTokens: integer(row.maximumTokens, 'maximumTokens', 0, 1_000_000),
    maximumCostUsd: number(row.maximumCostUsd, 'maximumCostUsd', 0, 1000),
    maximumAiActions: integer(row.maximumAiActions, 'maximumAiActions', 0, 5),
  }
}
export function frozenTtrpgOpenEpochBudgetV1(campaign: TtrpgCampaignContentV2): TtrpgOpenEpochBudgetV1 {
  const policy = campaign.runtimePolicy
  return parseTtrpgOpenEpochBudgetV1({ maximumCalls: policy.maximumCallsPerEpoch,
    maximumTokens: policy.maximumEpochTokens, maximumCostUsd: policy.maximumEpochCostUsd,
    maximumAiActions: policy.maxAiActions })
}
/** Passive drafting windows never grant game actions, Oracle or delegated hosting. */
export function isTtrpgOpenPassiveEpochV1(epoch: Pick<TtrpgOpenEpochV1, 'triggerKind' | 'oracleRuntimeReferencePolicy' | 'normalizationRuntimeReferencePolicy' | 'commonOracle'>): boolean {
  return Boolean(epoch.commonOracle || epoch.oracleRuntimeReferencePolicy || epoch.normalizationRuntimeReferencePolicy) || epoch.triggerKind === 'request-brief' || epoch.triggerKind === 'request-situation' || epoch.triggerKind === TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1
}
/** Closed event admission applies equally to the command preview and offline replay. */
export function assertTtrpgOpenSituationWindowEventV1(runtime: Pick<TtrpgRuntimeStateV2, 'openRun'> | null, type: string): void {
  assertTtrpgOpenEntityWindowEventV1(runtime, type)
  const run = runtime?.openRun, epoch = run?.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)
  if ((epoch?.commonOracle || epoch?.oracleRuntimeReferencePolicy || epoch?.normalizationRuntimeReferencePolicy) && !['ttrpg.open.epoch.closed', 'ttrpg.open.call.reserved', 'ttrpg.open.call.dispatched', 'ttrpg.open.call.finished',
    'ttrpg.open.oracle.reviewed', 'ttrpg.fact.asserted', 'ttrpg.safety.changed', 'ttrpg.session-zero.completed',
    'ttrpg.audio.voice.cancelled', 'ttrpg.open.table-message.posted', 'ttrpg.open.failure.logged'].includes(type)) fail('实例事实咨询只允许原模型请求、明确审阅、安全控制和结束，不能执行行动或另作咨询')
  if ((epoch?.triggerKind === 'request-situation' || epoch?.triggerKind === TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1) && ![
    'ttrpg.open.epoch.closed', 'ttrpg.open.call.reserved', 'ttrpg.open.call.dispatched', 'ttrpg.open.call.finished',
    'ttrpg.safety.changed', 'ttrpg.session-zero.completed', 'ttrpg.audio.voice.cancelled', 'ttrpg.open.table-message.posted', 'ttrpg.open.failure.logged', 'ttrpg.open.situation.accepted',
  ].includes(type)) fail('局势生成窗口仅允许请求记账、安全控制、桌面交流和明确结束；不能改变团内机械或事实状态')
}
export function ttrpgOpenEpochBudgetForTriggerV1(budget: unknown, triggerKind: TtrpgOpenEpochV1['triggerKind'], boundedSemanticDraft = false): TtrpgOpenEpochBudgetV1 {
  const base = parseTtrpgOpenEpochBudgetV1(budget)
  return boundedSemanticDraft || isTtrpgOpenPassiveEpochV1({ triggerKind }) ? { ...base, maximumCalls: Math.min(1, base.maximumCalls), maximumAiActions: 0 } : base
}
export function assertTtrpgOpenEpochPurposeV1(epoch: Pick<TtrpgOpenEpochV1, 'triggerKind' | 'oracleRuntimeReferencePolicy' | 'normalizationRuntimeReferencePolicy' | 'commonOracle'>, skillId: string): void {
  if (Boolean(epoch.commonOracle) !== (skillId === TTRPG_OPEN_COMMON_ORACLE_SKILL_V1)) fail('共同事实窗口与本次共同解释用途不一致，不能借用私域或其他授权')
  if (epoch.oracleRuntimeReferencePolicy && skillId !== 'prose.ttrpg-open-oracle-interpret') fail('实例事实窗口不能借用于其他模型目的')
  if (epoch.normalizationRuntimeReferencePolicy && skillId !== 'prose.ttrpg-open-fact-normalize') fail('实例归一窗口只允许整理原已接受解释，不能重新解释或执行行动')
  if ((epoch.triggerKind === 'request-brief') !== (skillId === 'prose.ttrpg-open-brief')) fail('复盘窗口与模型用途不一致，不得借用普通行动授权')
  if ((epoch.triggerKind === 'request-situation') !== (skillId === 'prose.ttrpg-open-situation-propose')) fail('局势生成窗口与模型用途不一致，不得借用其他授权')
  if ((epoch.triggerKind === TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1) !== (skillId === TTRPG_OPEN_PUBLIC_SITUATION_SKILL_V1)) fail('共同局势窗口与本次公开模型用途不一致')
}
export function assertTtrpgOpenBriefEpochAuthorityV1(runtime: Pick<TtrpgRuntimeStateV2, 'authorization' | 'openRun' | 'branchLineage'>, viewerKey: string): void {
  if (!runtime.authorization || !runtime.openRun) fail('复盘需要有效开团授权')
  assertTtrpgOpenHumanHostV1(runtime.authorization, viewerKey)
  if (runtime.authorization.seats.some(seat => !seat.consent.sessionLoggingAllowed)
    || runtime.openRun.operations.some(operation => ['awaiting-approval', 'executing'].includes(operation.status))
    || runtime.openRun.coordination.calls.some(call => ['prepared', 'dispatched'].includes(call.status))
    || runtime.branchLineage?.recoveryTasks.some(task => !['completed', 'withdrawn'].includes(task.status))) fail('复盘前须完成当前行动/继承恢复、原请求并取得本桌记录同意')
}
/** Requesting a GM draft does not grant the human fallback a GM private read. */
export function assertTtrpgOpenSituationEpochAuthorityV1(runtime: TtrpgRuntimeStateV2, viewerKey: string): void {
  assertTtrpgOpenBriefEpochAuthorityV1(runtime, viewerKey)
  const gm = runtime.authorization!.seats.find(seat => seat.role === 'gm')
  if (!gm?.consent.aiAdviceAllowed || !gm.consent.aiIdentityDisclosed
    || runtime.openRun!.stage.status !== 'open' || runtime.product.safety.status !== 'active') fail('局势生成需要当前 AI GM 资料读取同意、进行中的阶段与未暂停的本桌')
}

export function assertTtrpgOpenOracleRuntimeEpochAuthorityV1(runtime: TtrpgRuntimeStateV2, viewerKey: string): void {
  assertTtrpgOpenBriefEpochAuthorityV1(runtime, viewerKey)
  const seat = runtime.authorization!.seats.find(row => row.viewerKey === viewerKey)
  if (!seat || seat.role !== 'gm' || seat.controller === 'ai' || !seat.consent.aiAdviceAllowed || !seat.consent.aiIdentityDisclosed
    || runtime.openRun!.stage.status !== 'open' || runtime.product.safety.status !== 'active'
    || runtime.openRun!.entityOperations?.some(row => !row.resolution)) fail('实例事实模型请求需要本人真人 GM、当前 AI 读取同意与空闲未暂停的进行中阶段')
}
/** Current real human host; source hashes and player ownership alone confer no GM-private right. */
export function assertTtrpgOpenCommonOracleEpochAuthorityV1(runtime: TtrpgRuntimeStateV2, viewerKey: string): void {
  assertTtrpgOpenBriefEpochAuthorityV1(runtime, viewerKey)
  const seat = assertTtrpgOpenHumanHostV1(runtime.authorization!, viewerKey), gm = runtime.authorization!.seats.find(row => row.role === 'gm')
  if (gm?.controller !== 'ai' || !gm.consent.aiAdviceAllowed || !gm.consent.aiIdentityDisclosed || !seat.consent.aiAdviceAllowed
    || runtime.product.safety.status !== 'active' || runtime.openRun!.stage.status !== 'open'
    || runtime.openRun!.entityOperations?.some(row => !row.resolution)) fail('共同事实请求需要当前 AI 主持、本人真人主持同意与空闲未暂停的进行中阶段')
}
/** Replay checks real source identities and the recorded cut; async readers also verify the actual basis/source hashes. */
export function assertTtrpgOpenCommonOracleEpochOriginV1(runtime: TtrpgRuntimeStateV2, epoch: TtrpgOpenEpochV1): void {
  const grant = epoch.commonOracle
  if (!grant) fail('共同事实缺少本次原窗口证据')
  const basis = grant.basis, authorization = runtime.authorization!, seat = assertTtrpgOpenHumanHostV1(authorization, epoch.viewerKey)
  const oracle = runtime.openRun!.oracleReceipts?.find(row => JSON.stringify(row.sourceRef) === JSON.stringify(basis.oracleSourceRef))
  const original = oracle?.sourceRef.sessionKey === runtime.sessionKey ? authorization
    : runtime.branchLineage?.ancestors.find(row => row.sessionKey === oracle?.sourceRef.sessionKey)?.snapshot.authorization
  if (grant.worldTurn !== runtime.openRun!.worldTime.worldTurn || grant.epochKey !== epoch.epochKey || basis.sessionKey !== runtime.sessionKey || basis.sessionKey !== epoch.startedRef.sessionKey || basis.readEvidence.sequence + 1 !== epoch.startedRef.sequence
    || basis.requester.viewerKey !== epoch.viewerKey || basis.requester.seatKey !== seat.seatKey || basis.requester.seatRevision !== seat.revision
    || basis.authorizationRevision !== authorization.revision || epoch.sessionZeroRevision !== authorization.revision
    || JSON.stringify(basis.recipientActorKeys) !== JSON.stringify([...authorization.selectedActorKeys].sort())
    || basis.rulePackContentHash !== runtime.product.rulePackContentHash || !oracle || oracle.audience !== basis.audience
    || oracle.audience === 'party' && (!original || basis.recipientActorKeys.some(actor => !original.selectedActorKeys.includes(actor)))) fail('共同事实窗口没有准确本人、原切点、全体接收者或原咨询来源')
  if (basis.budget.maximumInputTokens + basis.budget.maximumOutputTokens > epoch.budget.maximumTokens || basis.budget.maximumCostUsd > epoch.budget.maximumCostUsd) fail('共同事实请求超过本次冻结窗口预算')
}
export function parseTtrpgOpenEpochV1(value: unknown): TtrpgOpenEpochV1 {
  const hasArchive = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'commonOracleArchive')
  const hasCommon = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'commonOracle')
  const hasManual = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value,'manualAction')
  const hasHosting = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value,'hostingDelegation')
  const hasPublic = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value,'publicSituation')
  const hasOracleReferences = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'oracleRuntimeReferencePolicy')
  const hasNormalizationReferences = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'normalizationRuntimeReferencePolicy')
  const hasRuntimeReferences = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'runtimeEntityReferencePolicy')
  const row = record(value, ['epochKey', 'startedRef', 'closedRef', 'status', 'triggeredBySeatKey',
    'viewerKey', 'triggerKind', 'inputRevision', 'sessionZeroRevision', 'authorizationHash', 'budget',
    'successfulActorKeys', 'reservedCalls', 'consumedTokens', 'actualCostUsd', 'stopReason', ...(hasCommon ? ['commonOracle'] : []), ...(hasArchive ? ['commonOracleArchive'] : []), ...(hasManual ? ['manualAction'] : []),...(hasHosting ? ['hostingDelegation'] : []), ...(hasPublic ? ['publicSituation'] : []),
    ...(hasRuntimeReferences ? ['runtimeEntityReferencePolicy'] : []), ...(hasOracleReferences ? ['oracleRuntimeReferencePolicy'] : []),
    ...(hasNormalizationReferences ? ['normalizationRuntimeReferencePolicy'] : [])], 'epoch')
  const manual = hasManual ? record(row.manualAction,['requestJson','requestHash'],'manual action authorization') : null
  const manualAction = manual ? { requestJson: text(manual.requestJson,'manual request',100_000),requestHash: hash(manual.requestHash,'manual request hash') } : undefined
  if (manualAction && row.triggerKind !== 'submit-action') fail('人工行动只能使用明确的新行动授权')
  if (row.status !== 'active' && row.status !== 'closed') fail('epoch.status 无效')
  if (row.triggerKind !== 'submit-action' && row.triggerKind !== 'continue-host' && row.triggerKind !== 'request-brief' && row.triggerKind !== 'request-situation' && row.triggerKind !== TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1) fail('epoch.triggerKind 无效')
  const startedRef = parseTtrpgOpenSourceRefV1(row.startedRef)
  const closedRef = row.closedRef === null ? null : parseTtrpgOpenSourceRefV1(row.closedRef)
  const stopReason = row.stopReason === null ? null : text(row.stopReason, 'stopReason', 2000)
  if ((row.status === 'active') !== (closedRef === null) || (row.status === 'active') !== (stopReason === null)) fail('epoch 终态回执不一致')
  if (closedRef && (closedRef.sessionKey !== startedRef.sessionKey || closedRef.sequence <= startedRef.sequence)) fail('epoch 关闭来源不属于当前 session 或不晚于开始')
  const budget = parseTtrpgOpenEpochBudgetV1(row.budget)
  const hostingDelegation = hasHosting ? parseTtrpgOpenHostingDelegationV1(row.hostingDelegation) : undefined
  if (hostingDelegation && (manualAction || hostingDelegation.epochKey !== row.epochKey || hostingDelegation.viewerKey !== row.viewerKey
    || hostingDelegation.sourceRef.sessionKey !== startedRef.sessionKey || hostingDelegation.sourceRef.sequence <= startedRef.sequence
    || hostingDelegation.authorizationRef.sequence >= startedRef.sequence
    || hostingDelegation.maximumCostUsdPerCall > budget.maximumCostUsd || closedRef && (hostingDelegation.sourceRef.sequence >= closedRef.sequence
      || hostingDelegation.stoppedRef && hostingDelegation.stoppedRef.sequence >= closedRef.sequence))) fail('有限主持委托不属于原窗口或超出原预算')
  const successfulActorKeys = list(row.successfulActorKeys, 'successfulActorKeys', v => key(v, 'successful actor'), 1000, 0)
  const publicSituation = hasPublic ? parseTtrpgOpenPublicSituationAuthorizationV1(row.publicSituation) : undefined
  const runtimeEntityReferencePolicy = hasRuntimeReferences ? parseTtrpgOpenSituationRuntimeReferencePolicyV1(row.runtimeEntityReferencePolicy) : undefined
  const oracleRuntimeReferencePolicy = hasOracleReferences ? parseTtrpgOpenOracleRuntimeReferencePolicyV1(row.oracleRuntimeReferencePolicy) : undefined
  const commonOracle = hasCommon ? parseTtrpgOpenCommonOracleAuthorizationV1(row.commonOracle) : undefined
  const normalizationRuntimeReferencePolicy = hasNormalizationReferences ? parseTtrpgOpenNormalizationRuntimeReferencePolicyV1(row.normalizationRuntimeReferencePolicy) : undefined
  if (commonOracle && (row.triggerKind !== 'continue-host' || manualAction || hostingDelegation || publicSituation || runtimeEntityReferencePolicy || oracleRuntimeReferencePolicy || normalizationRuntimeReferencePolicy
    || budget.maximumCalls !== 1 || budget.maximumAiActions !== 0 || successfulActorKeys.length)) fail('共同事实必须单独冻结一次调用、零行动和本次准确来源')
  if (normalizationRuntimeReferencePolicy && (row.triggerKind !== 'continue-host' || manualAction || hostingDelegation || publicSituation || runtimeEntityReferencePolicy || oracleRuntimeReferencePolicy
    || budget.maximumCalls !== 1 || budget.maximumAiActions !== 0 || successfulActorKeys.length)) fail('实例归一必须单独冻结一次调用、零行动和原已接受解释')
  if (oracleRuntimeReferencePolicy && (row.triggerKind !== 'continue-host' || manualAction || hostingDelegation || publicSituation || runtimeEntityReferencePolicy
    || budget.maximumCalls !== 1 || budget.maximumAiActions !== 0 || successfulActorKeys.length)) fail('实例事实策略必须独立冻结一次调用、零行动和原 Oracle，不能借用其他窗口')
  if (runtimeEntityReferencePolicy && (runtimeEntityReferencePolicy.consumer === 'private-gm' ? row.triggerKind !== 'request-situation'
    : row.triggerKind !== TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1 || !publicSituation
      || JSON.stringify(publicSituation.basis.runtimeEntityReferencePolicy) !== JSON.stringify(runtimeEntityReferencePolicy))) fail('实例引用策略不能借用其他用途或原请求授权')
  if (publicSituation?.basis.runtimeEntityReferencePolicy && !runtimeEntityReferencePolicy) fail('共同局势原请求实例策略未冻结在窗口中')
  if (Boolean(publicSituation) !== (row.triggerKind === TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1)) fail('共同局势必须绑定本次原 Run 授权，其他窗口不能携带该授权')
  if (publicSituation && (manualAction || hostingDelegation || budget.maximumCalls !== 1 || budget.maximumAiActions !== 0 || successfulActorKeys.length
    || publicSituation.basis.authorizationEpochKey !== row.epochKey || publicSituation.basis.sessionKey !== startedRef.sessionKey
    || publicSituation.basis.readEvidence.sequence + 1 !== startedRef.sequence || publicSituation.basis.requester.viewerKey !== row.viewerKey
    || publicSituation.basis.requester.seatKey !== row.triggeredBySeatKey || publicSituation.basis.authorizationRevision !== row.sessionZeroRevision
    || publicSituation.budget.maximumInputTokens + publicSituation.budget.maximumOutputTokens > budget.maximumTokens
    || publicSituation.budget.maximumCostUsd > budget.maximumCostUsd)) fail('共同局势授权的身份、原切点或预算不闭合')
  if (new Set(successfulActorKeys).size !== successfulActorKeys.length) fail('同 epoch 不能重复成功执行同一队友')
  if (row.triggerKind === 'request-brief' && (manualAction || hostingDelegation || budget.maximumCalls !== 1 || budget.maximumAiActions !== 0 || successfulActorKeys.length)) fail('复盘窗口只能保留一次模型额度，不能授予行动或主持委托')
  if (row.triggerKind === 'request-situation' && (manualAction || hostingDelegation || budget.maximumCalls !== 1 || budget.maximumAiActions !== 0 || successfulActorKeys.length)) fail('局势生成窗口只能保留一次模型额度，不能授予行动或主持委托')
  const reservedCalls = integer(row.reservedCalls, 'reservedCalls', 0, budget.maximumCalls)
  const consumedTokens = integer(row.consumedTokens, 'consumedTokens', 0, Number.MAX_SAFE_INTEGER)
  const actualCostUsd = row.actualCostUsd === null ? null : number(row.actualCostUsd, 'actualCostUsd', 0, 1_000_000)
  if (hasArchive && !commonOracle) fail('归档只能属于原共同事实窗口')
  const commonOracleArchive = hasArchive ? parseTtrpgOpenCommonOracleArchiveReceiptV1(row.commonOracleArchive) : undefined
  return { ...(commonOracleArchive ? { commonOracleArchive } : {}), ...(commonOracle ? { commonOracle } : {}), ...(normalizationRuntimeReferencePolicy ? { normalizationRuntimeReferencePolicy } : {}), ...(oracleRuntimeReferencePolicy ? { oracleRuntimeReferencePolicy } : {}), ...(runtimeEntityReferencePolicy ? { runtimeEntityReferencePolicy } : {}), ...(publicSituation ? { publicSituation } : {}), ...(hostingDelegation ? { hostingDelegation } : {}),...(manualAction ? { manualAction } : {}), epochKey: key(row.epochKey, 'epochKey'), startedRef, closedRef, status: row.status,
    triggeredBySeatKey: key(row.triggeredBySeatKey, 'triggeredBySeatKey'), viewerKey: key(row.viewerKey, 'viewerKey'),
    triggerKind: row.triggerKind, inputRevision: hash(row.inputRevision, 'inputRevision'),
    sessionZeroRevision: integer(row.sessionZeroRevision, 'sessionZeroRevision', 1, Number.MAX_SAFE_INTEGER),
    authorizationHash: hash(row.authorizationHash, 'authorizationHash'), budget, successfulActorKeys,
    reservedCalls, consumedTokens, actualCostUsd, stopReason }
}
export function parseTtrpgOpenCoordinationV1(value: unknown, sessionKey?: string): TtrpgOpenCoordinationV1 {
  const row = record(value, ['activeEpochKey', 'epochs', 'calls'], 'coordination')
  const activeEpochKey = row.activeEpochKey === null ? null : key(row.activeEpochKey, 'activeEpochKey')
  const epochs = list(row.epochs, 'epochs', parseTtrpgOpenEpochV1, 100_000, 0)
  const calls = list(row.calls, 'calls', parseTtrpgOpenModelCallV1, 100_000, 0)
  const epochsByKey = new Map(epochs.map(epoch => [epoch.epochKey, epoch]))
  const callsByEpoch = new Map<string, TtrpgOpenModelCallV1[]>()
  if (new Set(calls.map(call => call.requestKey)).size !== calls.length || calls.some(call => {
    const epoch = epochsByKey.get(call.authorizationEpochKey)
    if (epoch) assertTtrpgOpenEpochPurposeV1(epoch, call.skillId)
    const group = callsByEpoch.get(call.authorizationEpochKey) ?? []
    group.push(call); callsByEpoch.set(call.authorizationEpochKey, group)
    const hosting = epoch?.hostingDelegation,ref = call.hostingDelegationRef
    if (ref && (!hosting || hosting.sourceRef.sessionKey !== ref.sessionKey || hosting.sourceRef.sequence !== ref.sequence
      || call.reservedCostUsd > hosting.maximumCostUsdPerCall || hosting.stoppedRef && (call.createdRef.sequence >= hosting.stoppedRef.sequence
        || call.dispatchRef && call.dispatchRef.sequence >= hosting.stoppedRef.sequence))) fail('模型调用不能借用其他委托、超额或在撤销后派发')
    return !epoch || call.createdRef.sessionKey !== epoch.startedRef.sessionKey || call.createdRef.sequence <= epoch.startedRef.sequence
      || (epoch.status === 'closed' && (call.status === 'prepared' || call.status === 'dispatched'))
  })) fail('模型调用的 epoch/来源/终态不闭合')
  for (const epoch of epochs) {
    assertTtrpgOpenCommonOracleArchiveStateV1(epoch, calls.find(call => call.requestKey === epoch.commonOracleArchive?.requestKey))
    const totals = { ...epoch }
    const owned = callsByEpoch.get(epoch.epochKey) ?? []
    if (owned.length > epoch.budget.maximumCalls) fail('模型请求数超过冻结 epoch 上限')
    updateTtrpgOpenEpochCallTotalsV1(totals, owned)
    if (totals.reservedCalls !== epoch.reservedCalls || totals.consumedTokens !== epoch.consumedTokens || totals.actualCostUsd !== epoch.actualCostUsd) {
      fail('模型调用汇总必须由真实请求回执派生')
    }
  }
  const active = epochs.filter(epoch => epoch.status === 'active')
  if (new Set(epochs.map(epoch => epoch.epochKey)).size !== epochs.length
    || active.length > 1 || (active[0]?.epochKey ?? null) !== activeEpochKey
    || (sessionKey !== undefined && epochs.some(epoch => epoch.startedRef.sessionKey !== sessionKey))) fail('epoch 身份/活动指针/session 不一致')
  return { activeEpochKey, epochs, calls }
}

/** Keys are generated by the kernel; the hash path handles long portable keys. */
export async function ttrpgOpenScopedKeyV1(sessionKey: string, kind: string, parts: readonly string[]): Promise<string> {
  const session = key(sessionKey, 'sessionKey')
  const prefix = key(kind, 'kind')
  const candidate = [prefix, session, ...parts.map(part => key(part, 'key part'))].join('.')
  return candidate.length <= 200 ? candidate
    : `${prefix}.${await hashProductProductionValueV2({ sessionKey: session, kind: prefix, parts })}`
}

export function assertTtrpgOpenEpochAuthorityV1(input: {
  epoch: TtrpgOpenEpochV1
  authorization: TtrpgOpenAuthorizationV1
  authorizationHash: string
  viewerKey: string
}): void {
  if (input.epoch.status !== 'active' || input.epoch.viewerKey !== input.viewerKey
    || input.epoch.sessionZeroRevision !== input.authorization.revision
    || input.epoch.authorizationHash !== input.authorizationHash) fail('epoch 授权已变化或不属于当前 viewer')
}
