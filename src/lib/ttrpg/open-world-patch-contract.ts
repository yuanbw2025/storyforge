/** Portable author-review material. Integrity checking never grants world adoption or authenticates its sender. */
import type { WorldReferenceV1, ProductRuntimeEventType } from '../types'
import { PRODUCT_RUNTIME_EVENT_TYPES } from '../types'
import { validatePortableWorldReferenceV1 } from '../world-engine/world-reference'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { parseTtrpgOpenFactEntryV1, ttrpgOpenFactIdentityV1, hashTtrpgOpenOracleFactCandidateV1,
  ttrpgOpenOracleFactProposalFromFactV1, ttrpgOpenFactSourceEventRefV1, type TtrpgOpenFactEntryV1 } from './open-fact-ledger'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { frozenFact } from './open-content-predicates'
import type { TtrpgOpenFrozenFactV1 } from './open-contract'
import { ttrpgSessionFactsConflictV1, type TtrpgSessionFactV1 } from './session-facts'
import * as p from './open-contract-parse'

export const MAX_TTRPG_WORLD_PATCH_BYTES_V1 = 32 * 1024 * 1024

export interface TtrpgWorldPatchSourceV1 {
  worldReference: WorldReferenceV1; packageHash: string; releaseUid: string; releaseVersion: number;
  releaseIdentityHash: string; sourcePlanHash: string; sourceManifestHash: string; confirmedBriefHash: string;
  lineageHash: string; buildManifestHash: string; productInstanceKey: string; frozenIndexHash: string; rulePackContentHash: string; sourceBundleHash: string;
}
export interface TtrpgWorldPatchEventV1 { sourceRef: TtrpgOpenSourceRefV1; type: ProductRuntimeEventType; payloadHash: string }
export interface TtrpgWorldPatchFactV1 {
  entry: TtrpgOpenFactEntryV1; entryHash: string; confirmationEvent: TtrpgWorldPatchEventV1; oracleEvent: TtrpgWorldPatchEventV1;
}
export interface TtrpgWorldPatchCandidateV1 {
  schema: 'storyforge.ttrpg-world-patch-review'; version: 1; purpose: 'author-review-only';
  source: TtrpgWorldPatchSourceV1;
  cutpoint: { sessionKey: string; throughSequence: number; stateHash: string; eventPrefixHash: string;
    ancestors: Array<{ sessionKey: string; throughSequence: number; evidenceHash: string }> };
  includePrivate: boolean; includeGmOnly: boolean;
  decisions: Array<{ factKey: string; decision: 'selected-for-review' | 'pending' }>;
  facts: TtrpgWorldPatchFactV1[]; frozenComparisons: TtrpgOpenFrozenFactV1[];
  conflicts: Array<{ factKey: string; against: string; reason: 'frozen-invariant-conflict' | 'frozen-initial-state-difference' }>;
  exportedAt: number; reviewHash: string;
}
/** A new seat never gains historical party/private knowledge just by taking over as host. */
export function ttrpgWorldPatchFactVisibleV1(fact: Pick<TtrpgSessionFactV1, 'audience' | 'knownBy'>,
  reader: { isHumanGm: boolean; actorKey: string | null; includePrivate: boolean; includeGmOnly: boolean }): boolean {
  const knows = reader.actorKey !== null && fact.knownBy.includes(reader.actorKey)
  return fact.audience === 'public' || fact.audience === 'party' && (reader.isHumanGm || knows)
    || fact.audience === 'private' && reader.includePrivate && (reader.isHumanGm || knows)
    || fact.audience === 'gm-only' && reader.includeGmOnly && reader.isHumanGm
}
function parseReference(value: unknown): WorldReferenceV1 {
  const r = p.record(value, ['schema', 'version', 'worldCode', 'releaseUid', 'releaseVersion', 'releaseHash', 'localReleaseRecordId', 'manifestIdentity', 'capabilityIdentity', 'referenceHash'], 'patch world reference')
  const m = p.record(r.manifestIdentity, ['schema', 'version', 'semanticContract', 'schemaHash'], 'patch world manifest')
  const c = p.record(r.capabilityIdentity, ['catalogHash', 'profileHash'], 'patch world capabilities')
  return { schema: p.literal(r.schema, 'storyforge.world-reference', 'world schema'), version: p.literal(r.version, 1, 'world version'),
    worldCode: p.text(r.worldCode, 'world code', 200), releaseUid: p.text(r.releaseUid, 'world uid', 500), releaseVersion: p.integer(r.releaseVersion, 'world release version', 1),
    releaseHash: p.hash(r.releaseHash, 'world release hash'), localReleaseRecordId: p.literal(r.localReleaseRecordId, 0, 'portable locator'),
    referenceHash: p.hash(r.referenceHash, 'world reference hash'),
    manifestIdentity: { schema: p.literal(m.schema, 'storyforge.world-release', 'world manifest schema'), version: p.literal(m.version, 3, 'world manifest version'), semanticContract: p.literal(m.semanticContract, 3, 'world semantic contract'), schemaHash: p.hash(m.schemaHash, 'world schema hash') },
    capabilityIdentity: { catalogHash: p.hash(c.catalogHash, 'catalog hash'), profileHash: p.hash(c.profileHash, 'profile hash') } }
}
export function parseTtrpgWorldPatchSourceV1(value: unknown): TtrpgWorldPatchSourceV1 {
  const r = p.record(value, ['worldReference', 'packageHash', 'releaseUid', 'releaseVersion', 'releaseIdentityHash', 'sourcePlanHash', 'sourceManifestHash', 'confirmedBriefHash', 'lineageHash', 'buildManifestHash', 'productInstanceKey', 'frozenIndexHash', 'rulePackContentHash', 'sourceBundleHash'], 'patch immutable source')
  return { worldReference: parseReference(r.worldReference), packageHash: p.hash(r.packageHash, 'package hash'), releaseUid: p.text(r.releaseUid, 'release uid', 1000),
    releaseVersion: p.integer(r.releaseVersion, 'release version', 1), releaseIdentityHash: p.hash(r.releaseIdentityHash, 'release identity'),
    sourcePlanHash: p.hash(r.sourcePlanHash, 'source plan'), sourceManifestHash: p.hash(r.sourceManifestHash, 'source manifest'),
    confirmedBriefHash: p.hash(r.confirmedBriefHash, 'confirmed brief'), lineageHash: p.hash(r.lineageHash, 'release lineage'), buildManifestHash: p.hash(r.buildManifestHash, 'build manifest'),
    productInstanceKey: p.key(r.productInstanceKey, 'product instance'), frozenIndexHash: p.hash(r.frozenIndexHash, 'frozen index'), rulePackContentHash: p.hash(r.rulePackContentHash, 'frozen rules'), sourceBundleHash: p.hash(r.sourceBundleHash, 'source bundle') }
}
function parseEvent(value: unknown): TtrpgWorldPatchEventV1 {
  const r = p.record(value, ['sourceRef', 'type', 'payloadHash'], 'patch original event')
  return { sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef), type: p.oneOf(r.type, PRODUCT_RUNTIME_EVENT_TYPES, 'original event type'), payloadHash: p.hash(r.payloadHash, 'original event hash') }
}
export function ttrpgWorldPatchConflictsV1(facts: readonly TtrpgWorldPatchFactV1[], frozen: readonly TtrpgOpenFrozenFactV1[]): TtrpgWorldPatchCandidateV1['conflicts'] {
  return facts.flatMap(({ entry: { fact } }) => frozen.filter(f => ttrpgSessionFactsConflictV1(fact, { ...fact, ...f, knownBy: f.knownByActorKeys }))
    .map(f => ({ factKey: fact.factKey, against: f.factKey, reason: f.authority === 'invariant' ? 'frozen-invariant-conflict' as const : 'frozen-initial-state-difference' as const })))
}
export function parseTtrpgWorldPatchCandidateV1(value: unknown): TtrpgWorldPatchCandidateV1 {
  if (typeof value === 'string' && (value.length > MAX_TTRPG_WORLD_PATCH_BYTES_V1 || new TextEncoder().encode(value).byteLength > MAX_TTRPG_WORLD_PATCH_BYTES_V1)) p.fail('补丁文件超过 32 MB')
  const r = p.record(p.json(value), ['schema', 'version', 'purpose', 'source', 'cutpoint', 'includePrivate', 'includeGmOnly', 'decisions', 'facts', 'frozenComparisons', 'conflicts', 'exportedAt', 'reviewHash'], 'world patch')
  const c = p.record(r.cutpoint, ['sessionKey', 'throughSequence', 'stateHash', 'eventPrefixHash', 'ancestors'], 'patch cutpoint')
  const ancestors = p.list(c.ancestors, 'patch ancestors', value => {
    const a = p.record(value, ['sessionKey', 'throughSequence', 'evidenceHash'], 'patch ancestor')
    return { sessionKey: p.key(a.sessionKey, 'ancestor session'), throughSequence: p.integer(a.throughSequence, 'ancestor cutpoint', 0, Number.MAX_SAFE_INTEGER), evidenceHash: p.hash(a.evidenceHash, 'ancestor hash') }
  }, 1000)
  const decisions = p.list(r.decisions, 'patch decisions', value => { const d = p.record(value, ['factKey', 'decision'], 'patch decision'); return { factKey: p.key(d.factKey, 'decision fact'), decision: p.oneOf(d.decision, ['selected-for-review', 'pending'], 'decision') } }, 100000)
  const facts = p.list(r.facts, 'patch facts', value => { const f = p.record(value, ['entry', 'entryHash', 'confirmationEvent', 'oracleEvent'], 'patch fact'); return { entry: parseTtrpgOpenFactEntryV1(f.entry), entryHash: p.hash(f.entryHash, 'entry hash'), confirmationEvent: parseEvent(f.confirmationEvent), oracleEvent: parseEvent(f.oracleEvent) } }, 100000)
  const conflicts = p.list(r.conflicts, 'patch conflicts', value => { const f = p.record(value, ['factKey', 'against', 'reason'], 'patch conflict'); return { factKey: p.key(f.factKey, 'conflicting fact'), against: p.key(f.against, 'frozen fact'), reason: p.oneOf(f.reason, ['frozen-invariant-conflict', 'frozen-initial-state-difference'], 'conflict reason') } }, 100000)
  const result: TtrpgWorldPatchCandidateV1 = { schema: p.literal(r.schema, 'storyforge.ttrpg-world-patch-review', 'patch schema'), version: p.literal(r.version, 1, 'patch version'), purpose: p.literal(r.purpose, 'author-review-only', 'patch purpose'), source: parseTtrpgWorldPatchSourceV1(r.source),
    cutpoint: { sessionKey: p.key(c.sessionKey, 'current session'), throughSequence: p.integer(c.throughSequence, 'current cutpoint', 1, Number.MAX_SAFE_INTEGER), stateHash: p.hash(c.stateHash, 'cutpoint state'), eventPrefixHash: p.hash(c.eventPrefixHash, 'event prefix'), ancestors },
    includePrivate: p.bool(r.includePrivate, 'include private'), includeGmOnly: p.bool(r.includeGmOnly, 'include GM'), decisions, facts,
    frozenComparisons: p.list(r.frozenComparisons, 'frozen comparisons', frozenFact, 20000), conflicts, exportedAt: p.integer(r.exportedAt, 'export time', 1, Number.MAX_SAFE_INTEGER), reviewHash: p.hash(r.reviewHash, 'review hash') }
  p.unique(ancestors.map(a => a.sessionKey), 'ancestor sessions'); p.unique(decisions.map(d => d.factKey), 'decision facts'); p.unique(facts.map(f => f.entry.fact.factKey), 'selected facts'); p.unique(result.frozenComparisons.map(f => f.factKey), 'comparison facts')
  if (ancestors.some(a => a.sessionKey === result.cutpoint.sessionKey) || JSON.stringify(decisions.filter(d => d.decision === 'selected-for-review').map(d => d.factKey)) !== JSON.stringify(facts.map(f => f.entry.fact.factKey))) p.fail('补丁选择与来源身份不一致')
  for (const item of [...facts.map(f => f.entry.fact), ...result.frozenComparisons]) {
    if (item.audience === 'gm-only' && !result.includeGmOnly || item.audience === 'private' && !result.includePrivate) p.fail('补丁私密资料未经明确选择')
  }
  const limits = new Map([...ancestors.map(a => [a.sessionKey, a.throughSequence] as const), [result.cutpoint.sessionKey, result.cutpoint.throughSequence]])
  const order = [...ancestors.map(a => a.sessionKey), result.cutpoint.sessionKey]
  for (const f of facts) {
    for (const event of [f.confirmationEvent, f.oracleEvent]) if (event.sourceRef.sequence > (limits.get(event.sourceRef.sessionKey) ?? -1)) p.fail('补丁来源超出真实分支切点')
    if (JSON.stringify(f.entry.sourceRef) !== JSON.stringify(f.confirmationEvent.sourceRef) || JSON.stringify(f.entry.oracleSourceRef) !== JSON.stringify(f.oracleEvent.sourceRef)
      || !['ttrpg.fact.asserted', 'ttrpg.open.oracle.reviewed'].includes(f.confirmationEvent.type) || f.oracleEvent.type !== 'ttrpg.oracle.consulted') p.fail('补丁事实缺少确认或 Oracle 原事件')
    if (order.indexOf(f.oracleEvent.sourceRef.sessionKey) > order.indexOf(f.confirmationEvent.sourceRef.sessionKey)) p.fail('补丁 Oracle 来源晚于确认分支')
  }
  if (JSON.stringify(conflicts) !== JSON.stringify(ttrpgWorldPatchConflictsV1(facts, result.frozenComparisons))) p.fail('补丁冲突清单与冻结对照不一致')
  return result
}
/** Without a separately trusted source this checks integrity only, never original truth or world-write permission. */
export async function verifyTtrpgWorldPatchCandidateV1(value: unknown, expectedSource?: TtrpgWorldPatchSourceV1): Promise<TtrpgWorldPatchCandidateV1> {
  const result = parseTtrpgWorldPatchCandidateV1(value), { reviewHash, ...body } = result
  await validatePortableWorldReferenceV1(result.source.worldReference)
  if (await hash(body) !== reviewHash) p.fail('补丁文件 hash 校验失败')
  if (expectedSource && JSON.stringify(result.source) !== JSON.stringify(parseTtrpgWorldPatchSourceV1(expectedSource))) p.fail('补丁不属于指定冻结世界或产品版本')
  for (const { entry, entryHash } of result.facts) {
    if (await hash(entry) !== entryHash || entry.fact.factKey !== await ttrpgOpenFactIdentityV1(entry)
      || entry.fact.originRef !== await ttrpgOpenFactSourceEventRefV1(entry.oracleSourceRef)
      || entry.candidateHash !== await hashTtrpgOpenOracleFactCandidateV1({ proposal: ttrpgOpenOracleFactProposalFromFactV1(entry.fact), oracleSourceRef: entry.oracleSourceRef,
        runtimeSourceHash: result.source.packageHash, viewerKey: entry.viewerKey, baseStateHash: entry.confirmationStateHash })) p.fail('补丁事实原确认 hash 不一致')
  }
  return result
}
