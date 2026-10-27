/** One reviewed interpretation commits all selected facts atomically or none. */
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenOracleReviewV1, parseTtrpgOpenOracleReviewedEntriesV1, parseTtrpgOpenOracleReviewedRetirementsV1 } from './open-oracle-review'
import { assertTtrpgOpenModelFactApproverV1, assertTtrpgOpenFactModelCallV1, assertTtrpgOpenFactEntryGatesV1,
  parseTtrpgOpenFactLedger, ttrpgOpenSessionFactsV1, ttrpgOpenOracleFactProposalFromFactV1 } from './open-fact-ledger'
import { assertTtrpgOpenSemanticCallOriginV1 } from './open-model-calls'
import * as p from './open-contract-parse'
import { assertTtrpgOpenCommonOracleFactAudienceV1 } from './open-common-oracle-request'

export function applyTtrpgOpenOracleReviewEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type !== 'ttrpg.open.oracle.reviewed') return false
  p.exact(payload, ['review','entries','retirements','basis','basisHash','intent',
    ...(Object.prototype.hasOwnProperty.call(payload, 'stateLayoutVersion') ? ['stateLayoutVersion'] : [])], 'Oracle reviewed event')
  if (Object.prototype.hasOwnProperty.call(payload, 'stateLayoutVersion')) p.literal(payload.stateLayoutVersion, 1, 'Oracle review state layout version')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth) p.fail('Oracle 审阅需要正式已授权团局')
  const review = parseTtrpgOpenOracleReviewV1(payload.review), entries = parseTtrpgOpenOracleReviewedEntriesV1(payload.entries), retirements = parseTtrpgOpenOracleReviewedRetirementsV1(payload.retirements)
  const seat = assertTtrpgOpenModelFactApproverV1(auth, review.viewerKey)
  const epoch = run.coordination.epochs.find(epoch => epoch.epochKey === review.authorizationEpochKey)
  const call = run.coordination.calls.find(call => call.requestKey === review.requestKey)
  const oracle = run.oracleReceipts?.find(receipt => stable(receipt.sourceRef) === stable(review.oracleSourceRef))
  const intent = p.record(payload.intent, ['viewerKey','requestKey','candidateHash','interpretationDecision','interpretationReason','choices'], 'Oracle review intent')
  if (!epoch || epoch.status !== 'active' || epoch.viewerKey !== review.viewerKey || run.coordination.activeEpochKey !== epoch.epochKey
    || runtime.product.safety.status !== 'active' || run.stage.status !== 'open' || event.actorKey !== (seat.actorKey ?? 'gm') || event.targetKey !== null
    || stable(review.sourceRef) !== stable({ sessionKey: runtime.sessionKey, sequence: event.sequence }) || review.confirmationStateHash !== event.baseStateHash
    || !call || call.status !== 'succeeded' || call.authorizationEpochKey !== epoch.epochKey
    || call.runContractHash !== review.runContractHash || call.inputManifestHash !== review.inputManifestHash || call.responseArtifactHash !== review.rawResponseHash
    || !call.terminalRef || call.terminalRef.sequence >= event.sequence || !oracle || oracle.audience !== review.audience
    || run.oracleReviews?.some(previous => previous.requestKey === review.requestKey)
    || run.factLedger?.entries.some(entry => entry.modelCandidate?.requestKey === review.requestKey)
    || run.operations.some(operation => ['awaiting-approval','executing'].includes(operation.status))
    || runtime.branchLineage?.recoveryTasks.some(task => !['completed','withdrawn'].includes(task.status))) p.fail('Oracle 审阅的真人窗口、原始调用、事件或状态不闭合')
  assertTtrpgOpenSemanticCallOriginV1(call,review.oracleSourceRef,review.normalizationOf)
  if (epoch.commonOracle) for (const proposal of review.proposals) assertTtrpgOpenCommonOracleFactAudienceV1(epoch.commonOracle, proposal.audience, proposal.knownByActorKeys)
  if (intent.viewerKey !== review.viewerKey || intent.requestKey !== review.requestKey || intent.candidateHash !== review.candidateHash
    || intent.interpretationDecision !== review.interpretationDecision || intent.interpretationReason !== review.interpretationReason
    || stable(intent.choices) !== stable(review.choices)) p.fail('Oracle 审阅不是本次明确确认的完整选择')
  const selected = review.choices.filter(choice => choice.decision === 'adopt')
  if (entries.length !== selected.length || retirements.length !== entries.filter(entry => entry.fact.supersedes !== null).length
    || stable(entries.map(entry => entry.fact.factKey)) !== stable(review.adoptedFactKeys)) p.fail('Oracle 审阅不能漏写、添加或部分提交事实')
  let ledger = run.factLedger
  if (entries.length) {
    ledger ??= parseTtrpgOpenFactLedger({ schema: 'storyforge.ttrpg-open-fact-ledger', version: 1, basis: payload.basis, entries: [], retirements: [] })
    if ((run.factLedger && payload.basis !== null) || payload.basisHash !== ledger.basis.basisHash
      || ledger.basis.runtimeSourceHash !== review.runtimeSourceHash || ledger.basis.rulePackContentHash !== runtime.product.rulePackContentHash) p.fail('Oracle 批次缺少相同冻结事实基础')
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index], choice = selected[index], marker = entry.modelCandidate
      if (!marker || marker.proposalIndex !== choice.proposalIndex || marker.reviewHash !== review.reviewHash
        || stable(marker.normalizationOf ?? null) !== stable(review.normalizationOf ?? null)
        || marker.candidateHash !== review.candidateHash || marker.requestKey !== review.requestKey
        || stable(entry.sourceRef) !== stable(review.sourceRef) || stable(entry.oracleSourceRef) !== stable(review.oracleSourceRef)
        || entry.viewerKey !== review.viewerKey || entry.authorizationEpochKey !== epoch.epochKey || entry.confirmationStateHash !== review.confirmationStateHash
        || stable(ttrpgOpenOracleFactProposalFromFactV1(entry.fact)) !== stable(review.proposals[choice.proposalIndex])
        || ledger.entries.some(previous => previous.fact.factKey === entry.fact.factKey)) p.fail('Oracle 批次事实不是被选中的真实提案')
      assertTtrpgOpenFactModelCallV1(entry, run.coordination.calls)
      assertTtrpgOpenFactEntryGatesV1({ basis: ledger.basis, entries: ttrpgOpenSessionFactsV1(ledger), entry, oracle, authorization: auth,
        entityOperations: run.entityOperations, storyFacts: runtime.product.effectLedger.storyFacts })
      const retirement = entry.fact.supersedes === null ? null : retirements.find(retirement => retirement.factKey === entry.fact.supersedes)
      if ((entry.fact.supersedes !== null && !retirement) || (retirement && (retirement.supersededByFactKey !== entry.fact.factKey
        || retirement.reason !== entry.fact.supersedeReason || stable(retirement.sourceRef) !== stable(review.sourceRef)
        || retirement.viewerKey !== review.viewerKey || retirement.authorizationEpochKey !== epoch.epochKey))) p.fail('Oracle 批次替代必须原子退休相同旧事实')
      ledger = parseTtrpgOpenFactLedger({ ...ledger, entries: [...ledger.entries,entry], retirements: [...ledger.retirements,...(retirement ? [retirement] : [])] })
    }
    run.factLedger = ledger
  } else if (payload.basis !== null || payload.basisHash !== null || retirements.length) p.fail('无事实审阅不能伪造事实基础或退休事件')
  run.oracleReviews = [...(run.oracleReviews ?? []),review]
  state.ttrpg = payload.stateLayoutVersion === 1 ? parseTtrpgRuntimeStateV2(runtime)! : runtime
  return true
}
