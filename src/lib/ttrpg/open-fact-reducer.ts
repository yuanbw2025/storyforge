/** Deterministic replay enforces facts' own gates; no model, DB or world writes occur here. */
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenFactLedgerV1, parseTtrpgOpenFactEntryV1, parseTtrpgOpenFactRetirementV1,
  assertTtrpgOpenFactEntryGatesV1, assertTtrpgOpenModelFactApproverV1, assertTtrpgOpenFactModelCallV1,
  ttrpgOpenSessionFactsV1, parseTtrpgOpenOracleFactProposalV1, ttrpgOpenOracleFactProposalFromFactV1 } from './open-fact-ledger'
import * as p from './open-contract-parse'
import { assertTtrpgOpenCommonOracleFactAudienceV1 } from './open-common-oracle-request'

export function applyTtrpgOpenFactEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type !== 'ttrpg.fact.asserted' && event.type !== 'ttrpg.fact.retired') return false
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth) p.fail('正式事实需要已授权的 open 团局')
  const viewerKey = p.key(payload.viewerKey, 'fact viewer'), epochKey = p.key(payload.authorizationEpochKey, 'fact epoch')
  const seat = auth.seats.find(seat => seat.viewerKey === viewerKey)
  const epoch = run.coordination.epochs.find(epoch => epoch.epochKey === epochKey)
  const modelEntry = event.type === 'ttrpg.fact.asserted' ? parseTtrpgOpenFactEntryV1(payload.entry).modelCandidate
    : run.factLedger?.entries.find(entry => entry.fact.factKey === parseTtrpgOpenFactRetirementV1(payload.retirement).factKey)?.modelCandidate
  if (modelEntry) assertTtrpgOpenModelFactApproverV1(auth, viewerKey)
  if (!seat || (!modelEntry && seat.role !== 'gm') || seat.controller === 'ai' || seat.assignmentState !== 'claimed'
    || !epoch || epoch.status !== 'active' || epoch.viewerKey !== viewerKey || run.coordination.activeEpochKey !== epochKey
    || run.stage.status !== 'open' || runtime.product.safety.status !== 'active' || event.actorKey !== (seat.actorKey ?? 'gm')
    || run.operations.some(operation => ['awaiting-approval', 'executing'].includes(operation.status))
    || runtime.branchLineage?.recoveryTasks.some(task => !['completed', 'withdrawn'].includes(task.status))) p.fail('事实提交需要本人当前真人 GM 授权且没有待结算行动')
  const sourceRef = { sessionKey: runtime.sessionKey, sequence: event.sequence }
  let runtimeReferenceEntry = false
  if (event.type === 'ttrpg.fact.asserted') {
    p.exact(payload, ['viewerKey', 'authorizationEpochKey', 'basis', 'basisHash', 'entry', 'retirement', 'intent',
      ...(Object.prototype.hasOwnProperty.call(payload, 'stateLayoutVersion') ? ['stateLayoutVersion'] : [])], 'fact asserted')
    if (Object.prototype.hasOwnProperty.call(payload, 'stateLayoutVersion')) p.literal(payload.stateLayoutVersion, 1, 'fact state layout version')
    const entry = parseTtrpgOpenFactEntryV1(payload.entry)
    runtimeReferenceEntry = Boolean(entry.runtimeEntityReferences)
    if (entry.modelCandidate && run.oracleReviews?.some(review => review.requestKey === entry.modelCandidate!.requestKey)) p.fail('已完整审阅的候选不能另行采用弃用事实')
    const ledger = run.factLedger ?? parseTtrpgOpenFactLedgerV1({ schema: 'storyforge.ttrpg-open-fact-ledger', version: 1, basis: payload.basis, entries: [], retirements: [] })
    if ((run.factLedger && payload.basis !== null) || payload.basisHash !== ledger.basis.basisHash
      || ledger.basis.rulePackContentHash !== runtime.product.rulePackContentHash
      || stable(entry.sourceRef) !== stable(sourceRef) || entry.viewerKey !== viewerKey || entry.authorizationEpochKey !== epochKey
      || entry.confirmationStateHash !== event.baseStateHash || event.targetKey !== entry.fact.subjectRef
      || ledger.entries.some(previous => previous.fact.factKey === entry.fact.factKey)) p.fail('事实未绑定冻结来源、确认基线或真实事件')
    const oracle = run.oracleReceipts?.find(receipt => stable(receipt.sourceRef) === stable(entry.oracleSourceRef)) ?? p.fail('事实没有真实 Oracle 来源')
    const intent = p.record(payload.intent, ['viewerKey', 'oracleSourceRef', 'proposal', 'candidateHash',
      ...(entry.modelCandidate ? ['modelCandidate'] : []), ...(entry.runtimeEntityReferences ? ['referencePolicy'] : [])], 'fact assertion intent')
    if (entry.runtimeEntityReferences && intent.referencePolicy !== 'committed-runtime-entities-v1') p.fail('运行实体事实需要独立明确引用决定，不能扩展旧模型候选权限')
    if ((epoch.commonOracle || epoch.oracleRuntimeReferencePolicy || epoch.normalizationRuntimeReferencePolicy) && !entry.modelCandidate) p.fail('实例事实模型窗口不能借作人类原创确认')
    if (epoch.commonOracle) assertTtrpgOpenCommonOracleFactAudienceV1(epoch.commonOracle, entry.fact.audience, entry.fact.knownBy)
    if (entry.modelCandidate && stable(intent.modelCandidate) !== stable(entry.modelCandidate)) p.fail('模型候选不是本次明确确认的版本')
    assertTtrpgOpenFactModelCallV1(entry, run.coordination.calls)
    if (intent.viewerKey !== viewerKey || stable(intent.oracleSourceRef) !== stable(entry.oracleSourceRef) || intent.candidateHash !== entry.candidateHash
      || stable(parseTtrpgOpenOracleFactProposalV1(intent.proposal)) !== stable(ttrpgOpenOracleFactProposalFromFactV1(entry.fact))) p.fail('事实没有明确确认当前候选')
    assertTtrpgOpenFactEntryGatesV1({ basis: ledger.basis, entries: ttrpgOpenSessionFactsV1(ledger), entry, oracle, authorization: auth,
      entityOperations: run.entityOperations, storyFacts: runtime.product.effectLedger.storyFacts })
    const retirement = payload.retirement === null ? null : parseTtrpgOpenFactRetirementV1(payload.retirement)
    if ((entry.fact.supersedes === null) !== (retirement === null) || (retirement && (retirement.factKey !== entry.fact.supersedes
      || retirement.reason !== entry.fact.supersedeReason || retirement.supersededByFactKey !== entry.fact.factKey
      || stable(retirement.sourceRef) !== stable(sourceRef) || retirement.viewerKey !== viewerKey || retirement.authorizationEpochKey !== epochKey))) p.fail('事实替代必须同事件原子退休旧记录')
    run.factLedger = parseTtrpgOpenFactLedgerV1({ ...ledger, entries: [...ledger.entries, entry], retirements: [...ledger.retirements, ...(retirement ? [retirement] : [])] })
  } else {
    p.exact(payload, ['viewerKey', 'authorizationEpochKey', 'retirement', 'intent'], 'fact retired')
    const ledger = run.factLedger ?? p.fail('只能退休已存在的会话事实')
    const retirement = parseTtrpgOpenFactRetirementV1(payload.retirement)
    const intent = p.record(payload.intent, ['viewerKey', 'factKey', 'reason'], 'retirement intent')
    if (stable(retirement.sourceRef) !== stable(sourceRef) || retirement.viewerKey !== viewerKey || retirement.authorizationEpochKey !== epochKey
      || retirement.supersededByFactKey !== null || intent.viewerKey !== viewerKey || intent.factKey !== retirement.factKey || intent.reason !== retirement.reason
      || event.targetKey !== retirement.factKey || !ttrpgOpenSessionFactsV1(ledger).some(fact => fact.factKey === retirement.factKey && !fact.retired)) p.fail('事实退休没有合法活动记录或真实原因')
    run.factLedger = parseTtrpgOpenFactLedgerV1({ ...ledger, retirements: [...ledger.retirements, retirement] })
  }
  // New events freeze the parser layout explicitly; absence retains historical release-only bytes.
  // The first runtime-reference implementation already chose this layout through its own discriminator.
  state.ttrpg = runtimeReferenceEntry || payload.stateLayoutVersion === 1 ? parseTtrpgRuntimeStateV2(runtime)! : runtime
  return true
}
