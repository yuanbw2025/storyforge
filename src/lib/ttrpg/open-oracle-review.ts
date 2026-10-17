/** Portable, complete human review of one Oracle interpretation; no model or database access. */
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import type { TtrpgOpenOracleFactProposalV1, TtrpgOpenFactEntryV1, TtrpgOpenFactRetirementV1 } from './open-fact-ledger'
import { parseTtrpgOpenOracleFactProposalV1, parseTtrpgOpenFactEntryV1, parseTtrpgOpenFactRetirementV1 } from './open-fact-ledger'
import * as p from './open-contract-parse'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { assertTtrpgOpenModelFactApproverV1, ttrpgOpenOracleFactProposalFromFactV1 } from './open-fact-ledger'
import { ttrpgOpenAncestorSourceAllowedV1 } from './open-branch-contract'
import { assertTtrpgOpenSemanticCallOriginV1 } from './open-model-calls'
import { hashProductProductionValueV2 } from '../product-production/hash'
export interface TtrpgOpenOracleReviewChoiceV1 { proposalIndex: number; decision: 'adopt' | 'discard'; reason: string | null }
export interface TtrpgOpenOracleReviewV1 {
  schema: 'storyforge.ttrpg-open-oracle-review'; version: 1; sourceRef: TtrpgOpenSourceRefV1;
  authorizationEpochKey: string; viewerKey: string; requestKey: string; runContractHash: string;
  inputManifestHash: string; rawResponseHash: string; candidateHash: string; oracleSourceRef: TtrpgOpenSourceRefV1;
  runtimeSourceHash: string; confirmationStateHash: string; interpretation: string; audience: 'public' | 'party' | 'gm-only';
  interpretationDecision: 'accept' | 'reject'; interpretationReason: string | null;
  normalizationOf?: { sourceRef: TtrpgOpenSourceRefV1;reviewHash: string };
  proposals: TtrpgOpenOracleFactProposalV1[]; choices: TtrpgOpenOracleReviewChoiceV1[]; adoptedFactKeys: string[]; reviewHash: string;
}
export function parseTtrpgOpenOracleReviewChoiceV1(value: unknown): TtrpgOpenOracleReviewChoiceV1 {
  const r = p.record(value, ['proposalIndex', 'decision', 'reason'], 'Oracle fact review choice')
  const decision = p.oneOf(r.decision, ['adopt', 'discard'], 'Oracle fact decision')
  const reason = p.nullable(r.reason, (v,l) => p.text(v,l,2000), 'Oracle fact reason')
  if ((decision === 'discard') !== (reason !== null)) p.fail('弃用必须有原因，采用不能夹带另一份提案')
  return { proposalIndex: p.integer(r.proposalIndex, 'Oracle proposal index', 0, 2), decision, reason }
}
export function parseTtrpgOpenOracleReviewV1(value: unknown): TtrpgOpenOracleReviewV1 {
  const r = p.record(value, ['schema','version','sourceRef','authorizationEpochKey','viewerKey','requestKey','runContractHash',
    'inputManifestHash','rawResponseHash','candidateHash','oracleSourceRef','runtimeSourceHash','confirmationStateHash',
    'interpretation','audience','interpretationDecision','interpretationReason','proposals','choices','adoptedFactKeys','reviewHash',
    ...(Object.prototype.hasOwnProperty.call(value,'normalizationOf') ? ['normalizationOf'] : [])], 'Oracle review')
  const origin = Object.prototype.hasOwnProperty.call(r,'normalizationOf') ? p.record(r.normalizationOf,['sourceRef','reviewHash'],'review normalization origin') : null
  const proposals = p.list(r.proposals, 'review proposals', parseTtrpgOpenOracleFactProposalV1, 3)
  const choices = p.list(r.choices, 'review choices', parseTtrpgOpenOracleReviewChoiceV1, 3)
  const interpretationDecision = p.oneOf(r.interpretationDecision, ['accept','reject'], 'interpretation decision')
  const interpretationReason = p.nullable(r.interpretationReason, (v,l) => p.text(v,l,2000), 'interpretation reason')
  const adoptedFactKeys = p.keys(r.adoptedFactKeys, 'review adopted fact keys', 3)
  if (choices.length !== proposals.length || new Set(choices.map(choice => choice.proposalIndex)).size !== choices.length
    || choices.some((choice,index) => choice.proposalIndex !== index)
    || choices.filter(choice => choice.decision === 'adopt').length !== adoptedFactKeys.length
    || (interpretationDecision === 'reject' && (interpretationReason === null || adoptedFactKeys.length))
    || (interpretationDecision === 'accept' && interpretationReason !== null)) p.fail('必须逐项明确处置全部提案；拒绝解释不能采用其中事实')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-oracle-review', 'review schema'), version: p.literal(r.version, 1, 'review version'),
    sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef), authorizationEpochKey: p.key(r.authorizationEpochKey, 'review epoch'),
    viewerKey: p.key(r.viewerKey, 'review viewer'), requestKey: p.key(r.requestKey, 'review request'), runContractHash: p.hash(r.runContractHash, 'review contract'),
    inputManifestHash: p.hash(r.inputManifestHash, 'review manifest'), rawResponseHash: p.hash(r.rawResponseHash, 'review raw'),
    candidateHash: p.hash(r.candidateHash, 'review candidate'), oracleSourceRef: parseTtrpgOpenSourceRefV1(r.oracleSourceRef),
    runtimeSourceHash: p.hash(r.runtimeSourceHash, 'review runtime source'), confirmationStateHash: p.hash(r.confirmationStateHash, 'review confirmed state'),
    interpretation: p.text(r.interpretation, 'review interpretation', 8000), audience: p.oneOf(r.audience, ['public','party','gm-only'], 'review audience'),
    interpretationDecision, interpretationReason, proposals, choices, adoptedFactKeys,
    ...(origin ? { normalizationOf: { sourceRef: parseTtrpgOpenSourceRefV1(origin.sourceRef),reviewHash: p.hash(origin.reviewHash,'review normalization hash') } } : {}), reviewHash: p.hash(r.reviewHash, 'review hash') }
}
export function parseTtrpgOpenOracleReviewedEntriesV1(value: unknown): TtrpgOpenFactEntryV1[] {
  return p.list(value, 'review entries', parseTtrpgOpenFactEntryV1, 3)
}
export function parseTtrpgOpenOracleReviewedRetirementsV1(value: unknown): TtrpgOpenFactRetirementV1[] {
  return p.list(value, 'review retirements', parseTtrpgOpenFactRetirementV1, 3)
}
export function assertTtrpgOpenOracleReviewJournalV1(runtime: Pick<TtrpgRuntimeStateV2, 'sessionKey' | 'authorization' | 'openRun' | 'branchLineage'>): void {
  const run = runtime.openRun
  if (!run?.oracleReviews) return
  const seen = new Set<string>()
  for (const review of run.oracleReviews) {
    const current = review.sourceRef.sessionKey === runtime.sessionKey
    const source = current ? runtime : runtime.branchLineage?.ancestors.find(ancestor => ancestor.sessionKey === review.sourceRef.sessionKey)?.snapshot
    const auth = source?.authorization, sourceRun = source?.openRun
    if (!auth || !sourceRun || seen.has(review.requestKey)) p.fail('Oracle 审阅缺少唯一原授权来源')
    seen.add(review.requestKey)
    assertTtrpgOpenModelFactApproverV1(auth, review.viewerKey)
    const call = sourceRun.coordination.calls.find(call => call.requestKey === review.requestKey)
    const epoch = sourceRun.coordination.epochs.find(epoch => epoch.epochKey === review.authorizationEpochKey)
    const oracle = sourceRun.oracleReceipts?.find(receipt => stable(receipt.sourceRef) === stable(review.oracleSourceRef))
    if (!call || call.status !== 'succeeded'
      || call.runContractHash !== review.runContractHash || call.inputManifestHash !== review.inputManifestHash || call.responseArtifactHash !== review.rawResponseHash
      || call.runtimeSourceHash !== review.runtimeSourceHash
      || !call.terminalRef || call.terminalRef.sequence >= review.sourceRef.sequence || !oracle || oracle.audience !== review.audience
      || !epoch || epoch.viewerKey !== review.viewerKey || review.sourceRef.sequence <= epoch.startedRef.sequence
      || (epoch.closedRef !== null && review.sourceRef.sequence >= epoch.closedRef.sequence)
      || (!current && (!ttrpgOpenAncestorSourceAllowedV1(runtime.branchLineage, review.sourceRef, ['ttrpg.open.oracle.reviewed'])
        || !sourceRun.oracleReviews?.some(original => stable(original) === stable(review))))) p.fail('Oracle 审阅的调用、咨询、窗口或祖先证明不闭合')
    assertTtrpgOpenSemanticCallOriginV1(call,review.oracleSourceRef,review.normalizationOf)
    if (review.normalizationOf) {
      const ref = review.normalizationOf.sourceRef
      const original = sourceRun.oracleReviews?.find(original => stable(original.sourceRef) === stable(ref))
        ?? (call.supportSlot?.runtimeReferencePolicy && ttrpgOpenAncestorSourceAllowedV1(runtime.branchLineage, ref, ['ttrpg.open.oracle.reviewed'])
          ? runtime.branchLineage?.ancestors.find(row => row.sessionKey === ref.sessionKey)?.snapshot.openRun?.oracleReviews?.find(row => stable(row.sourceRef) === stable(ref)) : undefined)
      const semanticTuple = (fact: TtrpgOpenOracleFactProposalV1) => stable([fact.subjectRef,fact.predicateKey,fact.objectRef,fact.canonicalValue])
      const discarded = original?.choices.filter(choice => choice.decision === 'discard').map(choice => original.proposals[choice.proposalIndex]) ?? []
      if (!original || original.normalizationOf || original.interpretationDecision !== 'accept' || original.reviewHash !== review.normalizationOf.reviewHash
        || review.interpretation !== original.interpretation || review.proposals.some(fact => discarded.some(rejected => semanticTuple(rejected) === semanticTuple(fact)))) p.fail('归一审阅不能更换已确认解释、嵌套归一或复活弃用事实')
    }
    const entries = run.factLedger?.entries.filter(entry => entry.modelCandidate?.reviewHash === review.reviewHash) ?? []
    if (stable(entries.map(entry => entry.fact.factKey)) !== stable(review.adoptedFactKeys)
      || entries.some(entry => stable(entry.sourceRef) !== stable(review.sourceRef) || entry.viewerKey !== review.viewerKey
        || entry.modelCandidate?.candidateHash !== review.candidateHash
        || review.choices[entry.modelCandidate!.proposalIndex]?.decision !== 'adopt'
        || stable(ttrpgOpenOracleFactProposalFromFactV1(entry.fact)) !== stable(review.proposals[entry.modelCandidate!.proposalIndex]))) p.fail('Oracle 审阅与真实采用事实集合不一致')
  }
  if (run.factLedger?.entries.some(entry => entry.modelCandidate?.reviewHash
    && !run.oracleReviews!.some(review => review.reviewHash === entry.modelCandidate!.reviewHash))) p.fail('批次事实缺少完整审阅回执')
}
export async function verifyTtrpgOpenOracleReviewHashesV1(reviews: readonly TtrpgOpenOracleReviewV1[]): Promise<void> {
  for (const review of reviews) {
    const { reviewHash, ...body } = parseTtrpgOpenOracleReviewV1(review)
    if (reviewHash !== await hashProductProductionValueV2(body)) p.fail('Oracle 审阅字节或所选提案已变化')
  }
}
