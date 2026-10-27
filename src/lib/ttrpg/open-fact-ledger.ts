/** Session facts have one append-only owner; retirement is derived from real journal events. */
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenFactPolicyV1, TtrpgFrozenWorldPredicateIndexV1, TtrpgPredicateV1, TtrpgOpenAudience } from './open-contract'
import { OPEN_FACT_PREDICATES } from './open-contract'
import { parseTtrpgFrozenWorldPredicateIndexV1 } from './frozen-facts'
import { parseTtrpgOpenFactPolicyV1 } from './rule-pack-v2'
import { parseTtrpgPredicateV1 } from './predicate'
import { parseTtrpgSessionFactV1, assertTtrpgSessionFactGatesV1, retireTtrpgSessionFactV1, type TtrpgSessionFactV1 } from './session-facts'
import { parseTtrpgOpenSourceRefV1, ttrpgOpenScopedKeyV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import type { TtrpgOpenOracleReceiptV1 } from './open-oracle-contract'
import type { TtrpgOpenAuthorizationV1 } from './open-authorization'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'
import { assertTtrpgOpenSemanticCallOriginV1, ttrpgOpenSemanticRuntimeReferencePolicyV1 } from './open-model-calls'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'
import type { TtrpgOpenEntityOperationV1 } from './open-entity-contract'
import { parseTtrpgOpenFactRuntimeReferencesV1, assertTtrpgOpenFactRuntimeReferencesV1, verifyTtrpgOpenFactRuntimeReferenceHashV1,
  type TtrpgOpenFactRuntimeReferencesV1 } from './open-fact-runtime-references'

export interface TtrpgOpenOracleFactProposalV1 {
  kind: TtrpgSessionFactV1['kind']; subjectRef: string; predicateKey: TtrpgSessionFactV1['predicateKey']; objectRef: string | null;
  canonicalValue: TtrpgSessionFactV1['canonicalValue']; detail: string; sourceFactRefs: string[];
  audience: TtrpgOpenAudience; knownByActorKeys: string[]; supersedes: string | null; supersedeReason: string | null;
}
export interface TtrpgOpenFactBasisV1 {
  runtimeSourceHash: string; rulePackContentHash: string; frozenWorldPredicateIndex: TtrpgFrozenWorldPredicateIndexV1;
  canonInvariantPredicates: TtrpgPredicateV1[]; factPolicy: TtrpgOpenFactPolicyV1[];
  entityReferences: Array<{ entityRef: string; audience: TtrpgOpenAudience; knownByActorKeys: string[]; playerControlled: boolean }>;
  basisHash: string;
}
export interface TtrpgOpenFactEntryV1 {
  fact: TtrpgSessionFactV1; sourceRef: TtrpgOpenSourceRefV1; oracleSourceRef: TtrpgOpenSourceRefV1;
  authorizationEpochKey: string; viewerKey: string; candidateHash: string; confirmationStateHash: string;
  modelCandidate?: TtrpgOpenFactModelCandidateV1;
  /** Present only for the explicit versioned runtime-entity fact path; old entries retain exact bytes. */
  runtimeEntityReferences?: TtrpgOpenFactRuntimeReferencesV1;
}
export interface TtrpgOpenFactModelCandidateV1 {
  requestKey: string; runContractHash: string; candidateHash: string; inputManifestHash: string; rawResponseHash: string; proposalIndex: number;
  reviewHash?: string;
  normalizationOf?: { sourceRef: TtrpgOpenSourceRefV1;reviewHash: string };
}
export function parseTtrpgOpenFactModelCandidateV1(value: unknown): TtrpgOpenFactModelCandidateV1 {
  const r = p.record(value, ['requestKey', 'runContractHash', 'candidateHash', 'inputManifestHash', 'rawResponseHash', 'proposalIndex',
    ...(Object.prototype.hasOwnProperty.call(value, 'reviewHash') ? ['reviewHash'] : []),
    ...(Object.prototype.hasOwnProperty.call(value,'normalizationOf') ? ['normalizationOf'] : [])], 'model fact candidate')
  const origin = Object.prototype.hasOwnProperty.call(r,'normalizationOf') ? p.record(r.normalizationOf,['sourceRef','reviewHash'],'normalization origin') : null
  return { requestKey: p.key(r.requestKey, 'fact model request'), runContractHash: p.hash(r.runContractHash, 'fact model contract'),
    candidateHash: p.hash(r.candidateHash, 'fact model candidate'), inputManifestHash: p.hash(r.inputManifestHash, 'fact model input'),
    rawResponseHash: p.hash(r.rawResponseHash, 'fact model raw response'), proposalIndex: p.integer(r.proposalIndex, 'selected fact index', 0, 2),
    ...(Object.prototype.hasOwnProperty.call(r, 'reviewHash') ? { reviewHash: p.hash(r.reviewHash, 'fact review hash') } : {}),
    ...(origin ? { normalizationOf: { sourceRef: parseTtrpgOpenSourceRefV1(origin.sourceRef),reviewHash: p.hash(origin.reviewHash,'normalization origin hash') } } : {}) }
}
/** AI GM mode still requires the Session Zero human owner to explicitly confirm the selected fact. */
export function assertTtrpgOpenModelFactApproverV1(authorization: TtrpgOpenAuthorizationV1, viewerKey: string) {
  const seat = authorization.seats.find(seat => seat.viewerKey === viewerKey), gm = authorization.seats.find(seat => seat.role === 'gm')
  if (!seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || !gm?.consent.aiAdviceAllowed || !gm.consent.aiIdentityDisclosed
    || (gm.controller === 'ai' ? seat.seatKey !== authorization.completedBySeatKey : seat.role !== 'gm')) p.fail('模型事实需要真人 GM 或 AI GM 模式的 Session Zero 确认者明确批准')
  return seat
}
export function assertTtrpgOpenFactModelCallV1(entry: TtrpgOpenFactEntryV1, calls: readonly TtrpgOpenModelCallV1[]): void {
  if (!entry.modelCandidate) return
  const marker = entry.modelCandidate, call = calls.find(call => call.requestKey === marker.requestKey)
  if (!call || call.actorKey !== 'gm' || call.status !== 'succeeded'
    || call.runContractHash !== marker.runContractHash || call.inputManifestHash !== marker.inputManifestHash || call.responseArtifactHash !== marker.rawResponseHash
    || call.authorizationEpochKey !== entry.authorizationEpochKey || !call.terminalRef
    || call.terminalRef.sessionKey !== entry.sourceRef.sessionKey || call.terminalRef.sequence >= entry.sourceRef.sequence
    ) p.fail('事实没有同一已完成语义模型请求的真实输入和原始响应回执')
  assertTtrpgOpenSemanticCallOriginV1(call,entry.oracleSourceRef,marker.normalizationOf)
  if (entry.runtimeEntityReferences) {
    const policy = ttrpgOpenSemanticRuntimeReferencePolicyV1(call)
    if (!policy || entry.runtimeEntityReferences.runtimeSourceHash !== policy.references.runtimeSourceHash
      || entry.runtimeEntityReferences.rulePackContentHash !== policy.references.rulePackContentHash
      || entry.runtimeEntityReferences.references.some(row => !policy.references.references.some(original => stable(row) === stable({
        entityRef: original.entityRef, audience: original.audience, knownByActorKeys: original.recipientActorKeys,
        sourceRef: original.sourceRef, operationKey: original.operationKey, planHash: original.planHash })))) p.fail('模型运行事实没有原新版调用实际读取的准确创建来源')
  }
}
export interface TtrpgOpenFactRetirementV1 {
  factKey: string; sourceRef: TtrpgOpenSourceRefV1; authorizationEpochKey: string; viewerKey: string;
  reason: string; supersededByFactKey: string | null;
}
export interface TtrpgOpenFactLedgerV1 {
  schema: 'storyforge.ttrpg-open-fact-ledger'; version: 1; basis: TtrpgOpenFactBasisV1;
  entries: TtrpgOpenFactEntryV1[]; retirements: TtrpgOpenFactRetirementV1[];
}
export function ttrpgOpenOracleFactProposalFromFactV1(fact: TtrpgSessionFactV1): TtrpgOpenOracleFactProposalV1 {
  const { kind, subjectRef, predicateKey, objectRef, canonicalValue, detail, sourceFactRefs, audience, knownBy, supersedes, supersedeReason } = fact
  return { kind, subjectRef, predicateKey, objectRef, canonicalValue, detail, sourceFactRefs, audience, knownByActorKeys: knownBy, supersedes, supersedeReason }
}
export function parseTtrpgOpenOracleFactProposalV1(value: unknown): TtrpgOpenOracleFactProposalV1 {
  const r = p.record(value, ['kind', 'subjectRef', 'predicateKey', 'objectRef', 'canonicalValue', 'detail', 'sourceFactRefs', 'audience', 'knownByActorKeys', 'supersedes', 'supersedeReason'], 'oracle fact proposal')
  const { knownByActorKeys, ...body } = r
  const parsed = parseTtrpgSessionFactV1({ ...body, knownBy: knownByActorKeys,
    factKey: 'shape.only', layer: 'session', origin: 'oracle', originEventSequence: 1, originRef: 'shape.only', sourceEventRefs: ['shape.only'], retired: false, retiredAtSequence: null })
  return ttrpgOpenOracleFactProposalFromFactV1(parsed)
}
export async function hashTtrpgOpenOracleFactCandidateV1(input: {
  proposal: TtrpgOpenOracleFactProposalV1; oracleSourceRef: TtrpgOpenSourceRefV1; runtimeSourceHash: string; viewerKey: string; baseStateHash: string;
}): Promise<string> {
  return hashProductProductionValueV2({ schema: 'storyforge.ttrpg-open-oracle-fact-candidate', version: 1,
    proposal: parseTtrpgOpenOracleFactProposalV1(input.proposal), oracleSourceRef: parseTtrpgOpenSourceRefV1(input.oracleSourceRef),
    runtimeSourceHash: p.hash(input.runtimeSourceHash, 'fact source'), viewerKey: p.key(input.viewerKey, 'fact viewer'),
    baseStateHash: p.hash(input.baseStateHash, 'fact confirmation state') })
}
export async function ttrpgOpenFactSourceEventRefV1(sourceRef: TtrpgOpenSourceRefV1): Promise<string> {
  return `source.${await hashProductProductionValueV2(parseTtrpgOpenSourceRefV1(sourceRef))}`
}
export async function ttrpgOpenFactIdentityV1(entry: { sourceRef: TtrpgOpenSourceRefV1; fact: Pick<TtrpgSessionFactV1, 'subjectRef' | 'predicateKey'>; modelCandidate?: TtrpgOpenFactModelCandidateV1 }): Promise<string> {
  return ttrpgOpenScopedKeyV1(entry.sourceRef.sessionKey, 'fact', [String(entry.sourceRef.sequence), entry.fact.subjectRef, entry.fact.predicateKey,
    ...(entry.modelCandidate?.reviewHash ? ['proposal', String(entry.modelCandidate.proposalIndex)] : [])])
}
export async function createTtrpgOpenFactBasisV1(content: TtrpgRuntimeContentV2, runtimeSourceHash: string): Promise<TtrpgOpenFactBasisV1> {
  const body = { runtimeSourceHash, rulePackContentHash: content.rulePack.contentHash,
    frozenWorldPredicateIndex: structuredClone(content.campaign.frozenWorldPredicateIndex),
    canonInvariantPredicates: structuredClone(content.campaign.canonInvariantPredicates), factPolicy: structuredClone(content.rulePack.content.factPolicy),
    entityReferences: content.campaign.entityBindings.map(binding => ({ entityRef: binding.bindingKey, audience: binding.audience,
      knownByActorKeys: [...binding.knownByActorKeys], playerControlled: content.campaign.characterTemplates.some(character => character.characterKey === binding.bindingKey && character.role === 'player') })) }
  return { ...body, basisHash: await hashProductProductionValueV2(body) }
}
function parseBasis(value: unknown): TtrpgOpenFactBasisV1 {
  const b = p.record(value, ['runtimeSourceHash', 'rulePackContentHash', 'frozenWorldPredicateIndex', 'canonInvariantPredicates', 'factPolicy', 'entityReferences', 'basisHash'], 'fact basis')
  const factPolicy = p.list(b.factPolicy, 'fact policy', parseTtrpgOpenFactPolicyV1, 12, 12)
  if (factPolicy.map(policy => policy.predicateKey).sort().join(',') !== [...OPEN_FACT_PREDICATES].sort().join(',')) p.fail('事实策略必须覆盖冻结十二谓词')
  const entityReferences = p.list(b.entityReferences, 'fact entity references', value => {
    const r = p.record(value, ['entityRef', 'audience', 'knownByActorKeys', 'playerControlled'], 'fact entity ref')
    return { entityRef: p.key(r.entityRef, 'fact entity key'), audience: p.oneOf(r.audience, p.AUDIENCES, 'fact entity audience'),
      knownByActorKeys: p.keys(r.knownByActorKeys, 'fact entity known by', 1000), playerControlled: p.bool(r.playerControlled, 'fact player controlled') }
  }, 10000)
  p.unique(entityReferences.map(ref => ref.entityRef), 'fact entity refs')
  return { runtimeSourceHash: p.hash(b.runtimeSourceHash, 'fact runtime source'), rulePackContentHash: p.hash(b.rulePackContentHash, 'fact rule hash'),
    frozenWorldPredicateIndex: parseTtrpgFrozenWorldPredicateIndexV1(b.frozenWorldPredicateIndex),
    canonInvariantPredicates: p.list(b.canonInvariantPredicates, 'fact invariants', parseTtrpgPredicateV1, 10000), factPolicy, entityReferences,
    basisHash: p.hash(b.basisHash, 'fact basis hash') }
}
export function parseTtrpgOpenFactEntryV1(value: unknown): TtrpgOpenFactEntryV1 {
  const r = p.record(value, ['fact', 'sourceRef', 'oracleSourceRef', 'authorizationEpochKey', 'viewerKey', 'candidateHash', 'confirmationStateHash',
    ...(Object.prototype.hasOwnProperty.call(value, 'modelCandidate') ? ['modelCandidate'] : []),
    ...(Object.prototype.hasOwnProperty.call(value, 'runtimeEntityReferences') ? ['runtimeEntityReferences'] : [])], 'fact entry')
  const fact = parseTtrpgSessionFactV1(r.fact), sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef), oracleSourceRef = parseTtrpgOpenSourceRefV1(r.oracleSourceRef)
  if (fact.retired || fact.origin !== 'oracle' || fact.originEventSequence !== sourceRef.sequence || fact.originRef === null
    || fact.sourceEventRefs.length !== 1 || fact.sourceEventRefs[0] !== fact.originRef
    || (oracleSourceRef.sessionKey === sourceRef.sessionKey && oracleSourceRef.sequence >= sourceRef.sequence)) p.fail('新事实必须绑定真实前序 Oracle 和未退休起点')
  return { fact, sourceRef, oracleSourceRef, authorizationEpochKey: p.key(r.authorizationEpochKey, 'fact epoch'), viewerKey: p.key(r.viewerKey, 'fact viewer'),
    candidateHash: p.hash(r.candidateHash, 'fact candidate'), confirmationStateHash: p.hash(r.confirmationStateHash, 'fact confirmed state'),
    ...(Object.prototype.hasOwnProperty.call(r, 'modelCandidate') ? { modelCandidate: parseTtrpgOpenFactModelCandidateV1(r.modelCandidate) } : {}),
    ...(Object.prototype.hasOwnProperty.call(r, 'runtimeEntityReferences') ? { runtimeEntityReferences: parseTtrpgOpenFactRuntimeReferencesV1(r.runtimeEntityReferences) } : {}) }
}
export function parseTtrpgOpenFactRetirementV1(value: unknown): TtrpgOpenFactRetirementV1 {
  const r = p.record(value, ['factKey', 'sourceRef', 'authorizationEpochKey', 'viewerKey', 'reason', 'supersededByFactKey'], 'fact retirement')
  return { factKey: p.key(r.factKey, 'retired fact'), sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef),
    authorizationEpochKey: p.key(r.authorizationEpochKey, 'retirement epoch'), viewerKey: p.key(r.viewerKey, 'retirement viewer'),
    reason: p.text(r.reason, 'retirement reason', 1000), supersededByFactKey: p.nullable(r.supersededByFactKey, p.key, 'superseding fact') }
}
export function parseTtrpgOpenFactLedgerV1(value: unknown): TtrpgOpenFactLedgerV1 {
  const r = p.record(value, ['schema', 'version', 'basis', 'entries', 'retirements'], 'fact ledger')
  p.literal(r.schema, 'storyforge.ttrpg-open-fact-ledger', 'fact ledger schema'); p.literal(r.version, 1, 'fact ledger version')
  const entries = p.list(r.entries, 'fact entries', parseTtrpgOpenFactEntryV1, 100000)
  const retirements = p.list(r.retirements, 'fact retirements', parseTtrpgOpenFactRetirementV1, 100000)
  p.unique(entries.map(entry => entry.fact.factKey), 'fact keys'); p.unique(retirements.map(receipt => receipt.factKey), 'retired fact keys')
  for (const retirement of retirements) {
    const target = entries.find(entry => entry.fact.factKey === retirement.factKey)
    const replacement = entries.find(entry => entry.fact.factKey === retirement.supersededByFactKey)
    if (!target || (target.sourceRef.sessionKey === retirement.sourceRef.sessionKey && target.sourceRef.sequence >= retirement.sourceRef.sequence)
      || (retirement.supersededByFactKey !== null && (!replacement || stable(replacement.sourceRef) !== stable(retirement.sourceRef)
        || replacement.fact.supersedes !== target.fact.factKey || replacement.fact.supersedeReason !== retirement.reason))) p.fail('事实退休没有真实旧事实或原子替代依据')
  }
  if (entries.some(entry => entry.fact.supersedes !== null && !retirements.some(retirement => retirement.factKey === entry.fact.supersedes && retirement.supersededByFactKey === entry.fact.factKey))) {
    p.fail('事实替代必须在同一事件退休旧事实')
  }
  return { schema: 'storyforge.ttrpg-open-fact-ledger', version: 1, basis: parseBasis(r.basis), entries, retirements }
}
/** Explicit V2 keeps every inherited confirmation hash under its original basis. */
export interface TtrpgOpenFactLedgerV2 extends Omit<TtrpgOpenFactLedgerV1, 'version' | 'entries'> {
  version: 2; sourceBases: TtrpgOpenFactBasisV1[];
  entries: Array<TtrpgOpenFactEntryV1 & { originBasisHash?: string }>;
}
export type TtrpgOpenFactLedger = TtrpgOpenFactLedgerV1 | TtrpgOpenFactLedgerV2;
function factBasisSemantics(basis: TtrpgOpenFactBasisV1) {
  const { runtimeSourceHash: _source, basisHash: _hash, ...semantics } = basis;
  return semantics;
}
export function ttrpgOpenFactEntryBasis(ledger: TtrpgOpenFactLedger, entry: TtrpgOpenFactEntryV1): TtrpgOpenFactBasisV1 {
  if (ledger.version !== 2 || !('originBasisHash' in entry)) return ledger.basis;
  const key = p.hash(entry.originBasisHash, 'original fact basis');
  return ledger.sourceBases.find(basis => basis.basisHash === key) ?? p.fail('继承事实没有原始确认基础');
}
export function parseTtrpgOpenFactLedger(value: unknown): TtrpgOpenFactLedger {
  const raw = p.object(value, 'fact ledger version');
  if (raw.version !== 2) return parseTtrpgOpenFactLedgerV1(value);
  const r = p.record(raw, ['schema', 'version', 'basis', 'sourceBases', 'entries', 'retirements'], 'continued fact ledger');
  const entries = p.list(r.entries, 'continued fact entries', value => {
    const entry = p.object(value, 'continued fact entry'), { originBasisHash, ...original } = entry;
    return { original, originBasisHash: Object.prototype.hasOwnProperty.call(entry, 'originBasisHash') ? p.hash(originBasisHash, 'original fact basis') : null };
  }, 100000);
  const legacy = parseTtrpgOpenFactLedgerV1({ schema: r.schema, version: 1, basis: r.basis,
    entries: entries.map(e => e.original), retirements: r.retirements });
  const sourceBases = p.list(r.sourceBases, 'original fact bases', parseBasis, 1000);
  p.unique(sourceBases.map(b => b.basisHash), 'original fact bases');
  if (sourceBases.some(b => b.basisHash === legacy.basis.basisHash || stable(factBasisSemantics(b)) !== stable(factBasisSemantics(legacy.basis)))) p.fail('兼容续团不能改变事实世界、规则、实体或不变量');
  const result: TtrpgOpenFactLedgerV2 = { ...legacy, version: 2, sourceBases, entries: legacy.entries.map((entry, index) => ({ ...entry,
    ...(entries[index].originBasisHash ? { originBasisHash: entries[index].originBasisHash! } : {}) })) };
  for (const entry of result.entries) ttrpgOpenFactEntryBasis(result, entry);
  return result;
}
export function continueTtrpgOpenFactLedger(ledger: TtrpgOpenFactLedger, basis: TtrpgOpenFactBasisV1): TtrpgOpenFactLedgerV2 {
  const original = parseTtrpgOpenFactLedger(ledger), all = [...(original.version === 2 ? original.sourceBases : []), original.basis];
  const sourceBases = all.filter((b, index) => b.basisHash !== basis.basisHash && all.findIndex(other => other.basisHash === b.basisHash) === index);
  const continued = parseTtrpgOpenFactLedger({ ...original, version: 2, basis, sourceBases,
    entries: original.entries.map(entry => {
      const source = ttrpgOpenFactEntryBasis(original, entry), { originBasisHash: _old, ...body } = { originBasisHash: undefined, ...entry };
      return { ...body, ...(source.basisHash !== basis.basisHash ? { originBasisHash: source.basisHash } : {}) };
    }) });
  if (continued.version !== 2) p.fail('续团事实必须为明确 V2 格式');
  return continued;
}
export function ttrpgOpenSessionFactsV1(ledger?: TtrpgOpenFactLedger): TtrpgSessionFactV1[] {
  return (ledger?.entries ?? []).map(entry => {
    const retirement = ledger?.retirements.find(retirement => retirement.factKey === entry.fact.factKey)
    return retirement ? retireTtrpgSessionFactV1({ fact: entry.fact, retiredAtSequence: retirement.sourceRef.sequence }) : structuredClone(entry.fact)
  })
}
/** An old party audience is a frozen recipient grant; joining later does not reveal its history. */
export function projectTtrpgOpenSessionFactsForActorV1(ledger: TtrpgOpenFactLedger | undefined, actorKey: string) {
  return ttrpgOpenSessionFactsV1(ledger).filter(fact => !fact.retired && fact.audience !== 'gm-only'
    && (fact.audience === 'public' || fact.knownBy.includes(actorKey))).map(fact => ({
      factKey: fact.factKey, kind: fact.kind, subjectRef: fact.subjectRef, predicateKey: fact.predicateKey, objectRef: fact.objectRef,
      canonicalValue: fact.canonicalValue, detail: fact.detail, audience: fact.audience,
      sourceRef: structuredClone(ledger!.entries.find(entry => entry.fact.factKey === fact.factKey)!.sourceRef),
    }))
}
const SECRET_RANK: Record<TtrpgOpenAudience, number> = { public: 0, party: 1, private: 2, 'gm-only': 3 }
function entryEntityReferences(basis: TtrpgOpenFactBasisV1, entry: TtrpgOpenFactEntryV1, operations: readonly TtrpgOpenEntityOperationV1[]) {
  if (!entry.runtimeEntityReferences) return basis.entityReferences
  const references = assertTtrpgOpenFactRuntimeReferencesV1({ proof: entry.runtimeEntityReferences, ...basis, operations,
    entityRefs: [entry.fact.subjectRef, entry.fact.objectRef].filter((key): key is string => key !== null),
    frozenEntityRefs: basis.entityReferences.map(row => row.entityRef), factSourceRef: entry.sourceRef })
  if (references.some(row => SECRET_RANK[entry.fact.audience] < SECRET_RANK[row.audience]
    || entry.fact.audience !== 'gm-only' && row.audience !== 'public' && entry.fact.knownBy.some(key => !row.knownByActorKeys.includes(key)))) p.fail('运行事实不能扩大原实例的准确接收者')
  return [...basis.entityReferences, ...references.map(row => ({ entityRef: row.entityRef, audience: row.audience,
    knownByActorKeys: row.knownByActorKeys, playerControlled: false }))]
}
export function assertTtrpgOpenFactEntryGatesV1(input: {
  basis: TtrpgOpenFactBasisV1; entries: readonly TtrpgSessionFactV1[]; entry: TtrpgOpenFactEntryV1;
  oracle: TtrpgOpenOracleReceiptV1; authorization: TtrpgOpenAuthorizationV1; storyFacts: Readonly<Record<string, string | number | boolean | null>>;
  entityOperations?: readonly TtrpgOpenEntityOperationV1[];
}): void {
  const { basis, entry, oracle, authorization } = input, fact = entry.fact
  const entityReferences = entryEntityReferences(basis, entry, input.entityOperations ?? [])
  const policy = basis.factPolicy.find(policy => policy.predicateKey === fact.predicateKey)
  if (policy?.authority.session !== 'semantic-fact') p.fail('事实不能取代机械 owner 或未授权语义字段')
  if (stable(entry.oracleSourceRef) !== stable(oracle.sourceRef)) p.fail('事实来源必须是实际 Oracle 结果')
  const refs = [fact.subjectRef, fact.objectRef].filter((ref): ref is string => ref !== null)
  for (const ref of refs) {
    const binding = entityReferences.find(binding => binding.entityRef === ref)
    if (binding && (SECRET_RANK[fact.audience] < SECRET_RANK[binding.audience]
      || (fact.audience === 'private' && binding.audience === 'private' && fact.knownBy.some(actor => !binding.knownByActorKeys.includes(actor))))) p.fail('事实公开了无授权实体引用')
  }
  if (entityReferences.some(binding => binding.entityRef === fact.subjectRef && binding.playerControlled)
    && ['promised', 'knows'].includes(fact.predicateKey)) p.fail('Oracle 不能替玩家作决定或虚构玩家知识授予')
  if (fact.knownBy.some(actorKey => !authorization.selectedActorKeys.includes(actorKey))
    || (fact.audience === 'party' && stable([...fact.knownBy].sort()) !== stable([...authorization.selectedActorKeys].sort()))
    || (['public', 'gm-only'].includes(fact.audience) && fact.knownBy.length)) p.fail('事实接收者必须冻结到实际活动角色')
  if (fact.supersedes !== null && !fact.sourceFactRefs.includes(fact.supersedes)) p.fail('事实替代必须保留旧事实的真实来源与密级')
  const knownFacts = new Set([...basis.frozenWorldPredicateIndex.entries.map(fact => fact.factKey), ...input.entries.filter(fact => !fact.retired).map(fact => fact.factKey)])
  if (fact.sourceFactRefs.some(ref => !knownFacts.has(ref))) p.fail('事实引用不可解析或已退休来源')
  assertTtrpgSessionFactGatesV1({ fact, frozenWorldPredicateIndex: basis.frozenWorldPredicateIndex,
    canonInvariantPredicates: basis.canonInvariantPredicates, existingFacts: input.entries, factPolicy: basis.factPolicy,
    knownEntityRefs: entityReferences.map(binding => binding.entityRef), effectLedgerStoryFacts: input.storyFacts,
    sourceEvents: [{ eventRef: fact.originRef!, facts: [], audience: oracle.audience, knownBy: [], kind: 'ordinary' }] })
  if (basis.frozenWorldPredicateIndex.entries.some(invariant => invariant.authority === 'invariant' && invariant.subjectRef === fact.subjectRef
    && invariant.predicateKey === fact.predicateKey && invariant.objectRef === fact.objectRef)) p.fail('会话事实不能占用冻结不变量槽位')
}
export async function verifyTtrpgOpenFactLedger(input: {
  ledger?: TtrpgOpenFactLedger; content: TtrpgRuntimeContentV2; runtimeSourceHash: string;
  oracleReceipts: readonly TtrpgOpenOracleReceiptV1[]; storyFacts: Readonly<Record<string, string | number | boolean | null>>;
  entityOperations?: readonly TtrpgOpenEntityOperationV1[];
}): Promise<void> {
  if (!input.ledger) return
  const ledger = parseTtrpgOpenFactLedger(input.ledger)
  if (stable(ledger.basis) !== stable(await createTtrpgOpenFactBasisV1(input.content, input.runtimeSourceHash))) p.fail('事实账本与实际冻结世界/规则/实体来源不一致')
  for (const basis of ledger.version === 2 ? ledger.sourceBases : []) {
    const { basisHash, ...body } = basis;
    if (await hashProductProductionValueV2(body) !== basisHash) p.fail('原事实基础 hash 不一致');
  }
  if (ledger.entries.some(entry => entry.runtimeEntityReferences)) await (await import('./open-entity-proof')).verifyTtrpgOpenEntityPlanHashesV1(input.entityOperations ?? [], input.content)
  for (const entry of ledger.entries) {
    if (entry.runtimeEntityReferences) {
      await verifyTtrpgOpenFactRuntimeReferenceHashV1(entry.runtimeEntityReferences)
      entryEntityReferences(ttrpgOpenFactEntryBasis(ledger, entry), entry, input.entityOperations ?? [])
    }
    if (entry.fact.originRef !== await ttrpgOpenFactSourceEventRefV1(entry.oracleSourceRef)
      || entry.fact.factKey !== await ttrpgOpenFactIdentityV1(entry)
      || entry.candidateHash !== await hashTtrpgOpenOracleFactCandidateV1({ proposal: ttrpgOpenOracleFactProposalFromFactV1(entry.fact), oracleSourceRef: entry.oracleSourceRef,
        runtimeSourceHash: ttrpgOpenFactEntryBasis(ledger, entry).runtimeSourceHash, viewerKey: entry.viewerKey, baseStateHash: entry.confirmationStateHash })) p.fail('事实候选与真实来源或真人确认字节不一致')
  }
  const active = ttrpgOpenSessionFactsV1(ledger).filter(fact => !fact.retired)
  const originalSources = ledger.entries.map(entry => entry.fact)
  for (const fact of active) {
    const entry = ledger.entries.find(entry => entry.fact.factKey === fact.factKey)!
    const oracle = input.oracleReceipts.find(oracle => stable(oracle.sourceRef) === stable(entry.oracleSourceRef)) ?? p.fail('事实账本缺少真实 Oracle 来源')
    // G4 checks current truth. Supersession was already validated atomically by its event; old source metadata remains auditable.
    assertTtrpgSessionFactGatesV1({ fact: { ...fact, supersedes: null, supersedeReason: null }, existingFacts: active.filter(other => other.factKey !== fact.factKey),
      sourceFacts: originalSources, frozenWorldPredicateIndex: ledger.basis.frozenWorldPredicateIndex,
      canonInvariantPredicates: ledger.basis.canonInvariantPredicates, factPolicy: ledger.basis.factPolicy,
      knownEntityRefs: entryEntityReferences(ttrpgOpenFactEntryBasis(ledger, entry), entry, input.entityOperations ?? []).map(binding => binding.entityRef), effectLedgerStoryFacts: input.storyFacts,
      sourceEvents: [{ eventRef: fact.originRef!, facts: [], audience: oracle.audience, knownBy: [], kind: 'ordinary' }] })
  }
}

/** The explicit legacy verifier stays strict; runtime consumers use the dispatcher. */
export async function verifyTtrpgOpenFactLedgerV1(input: Omit<Parameters<typeof verifyTtrpgOpenFactLedger>[0], 'ledger'> & { ledger?: TtrpgOpenFactLedgerV1 }): Promise<void> {
  if (input.ledger) parseTtrpgOpenFactLedgerV1(input.ledger);
  return verifyTtrpgOpenFactLedger(input);
}
