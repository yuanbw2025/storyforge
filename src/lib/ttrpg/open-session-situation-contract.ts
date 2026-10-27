/** Session-owned immutable adoption. Generated prose is private until this exact human disclosure. */
import type { TtrpgSituationTemplateV1 } from './open-contract'
import { parseTtrpgSituationTemplateV1 } from './situation-engine'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'
import { extractExactArtifactOwnerRootsV1 } from '../memory/artifact-roots'
import type { ExactRunArtifactIdentityV1 } from '../types'
import { parseTtrpgOpenPublicSituationAuthorizationV1, type TtrpgOpenPublicSituationAuthorizationV1 } from './open-public-situation-authorization-contract'
import { parseTtrpgOpenRuntimeEntityReferencesV1, type TtrpgOpenRuntimeEntityReferencesV1 } from './open-runtime-entity-references'

export interface TtrpgOpenSessionSituationReceiptV1 {
  runtimeEntityReferences?: TtrpgOpenRuntimeEntityReferencesV1;
  schema: 'storyforge.ttrpg-open-session-situation'; version: 1;
  sourceRef: TtrpgOpenSourceRefV1; authorizationRef: TtrpgOpenSourceRefV1; runtimeSourceHash: string;
  acceptedAtWorldTurn: number; template: TtrpgSituationTemplateV1; templateHash: string; receiptHash: string; personalizationSourceKeys: string[];
  /** Exact historical contract/events with original physical locators. Opaque, immutable and never executable. */
  runOriginJson: string;
  artifactRefs: ExactRunArtifactIdentityV1[];
  model: { requestKey: string; epochKey: string; runContractHash: string; candidateHash: string; rawResponseHash: string;
    inputManifestHash: string; contextHash: string; basisHash: string; proposalHash: string; referencesHash: string };
  disclosure: { kind: 'human-gm-reviewed'; viewerKey: string; seatKey: string; authorizationHash: string;
    templateHash: string; scope: 'player-and-discovery-text-reviewed' };
}
export interface TtrpgOpenSessionSituationReceiptV2 extends Omit<TtrpgOpenSessionSituationReceiptV1, 'version' | 'disclosure'> {
  version: 2;
  disclosure: Omit<TtrpgOpenSessionSituationReceiptV1['disclosure'], 'kind' | 'scope'> & {
    kind: 'ai-host-once-authorized'; scope: 'this-one-common-candidate';
    gmSeatKey: string; gmSeatRevision: number; authorization: TtrpgOpenPublicSituationAuthorizationV1;
  };
}
export type TtrpgOpenSessionSituationReceipt = TtrpgOpenSessionSituationReceiptV1 | TtrpgOpenSessionSituationReceiptV2

function parseCommon(value: unknown) {
  const r = p.record(value, ['schema', 'version', 'sourceRef', 'authorizationRef', 'runtimeSourceHash', 'acceptedAtWorldTurn',
    'template', 'templateHash', 'receiptHash', 'personalizationSourceKeys', 'runOriginJson', 'artifactRefs', 'model', 'disclosure',
    ...(Object.prototype.hasOwnProperty.call(value, 'runtimeEntityReferences') ? ['runtimeEntityReferences'] : [])], 'session situation receipt')
  const model = p.record(r.model, ['requestKey', 'epochKey', 'runContractHash', 'candidateHash', 'rawResponseHash',
    'inputManifestHash', 'contextHash', 'basisHash', 'proposalHash', 'referencesHash'], 'original situation model proof')
  const template = parseTtrpgSituationTemplateV1(r.template), templateHash = p.hash(r.templateHash, 'accepted template hash')
  const sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef), authorizationRef = parseTtrpgOpenSourceRefV1(r.authorizationRef)
  if (!/^generated\.[a-f0-9]{40}$/.test(template.templateKey) || template.evidence.some(e => !e.clueRef.startsWith(template.templateKey + '.'))
    || sourceRef.sessionKey !== authorizationRef.sessionKey || sourceRef.sequence <= authorizationRef.sequence) p.fail('采用身份、披露版本或原始授权不一致')
  let runOriginJson: string
  if (r.version === 2) {
    if (typeof r.runOriginJson !== 'string' || !r.runOriginJson.trim() || r.runOriginJson.length > 8000000) p.fail('immutable historical Run archive: 字节为空或过长')
    runOriginJson = r.runOriginJson
  } else runOriginJson = p.text(r.runOriginJson, 'immutable historical Run archive', 8000000)
  const body = { schema: p.literal(r.schema, 'storyforge.ttrpg-open-session-situation', 'session situation schema'),
    sourceRef, authorizationRef, runtimeSourceHash: p.hash(r.runtimeSourceHash, 'accepted runtime source'),
    acceptedAtWorldTurn: p.integer(r.acceptedAtWorldTurn, 'situation acceptance turn', 0, Number.MAX_SAFE_INTEGER), template, templateHash,
    receiptHash: p.hash(r.receiptHash, 'session situation receipt hash'), personalizationSourceKeys: p.keys(r.personalizationSourceKeys, 'accepted personalization sources', 100, 1),
    runOriginJson, artifactRefs: parseTtrpgOpenSituationArtifactRefsV1(r.artifactRefs), model: {
      requestKey: p.key(model.requestKey, 'original situation request'), epochKey: p.key(model.epochKey, 'original situation epoch'),
      runContractHash: p.hash(model.runContractHash, 'original situation run'), candidateHash: p.hash(model.candidateHash, 'original situation candidate'),
      rawResponseHash: p.hash(model.rawResponseHash, 'original situation response'), inputManifestHash: p.hash(model.inputManifestHash, 'original situation manifest'),
      contextHash: p.hash(model.contextHash, 'original situation context'), basisHash: p.hash(model.basisHash, 'original situation basis'),
      proposalHash: p.hash(model.proposalHash, 'original situation proposal'), referencesHash: p.hash(model.referencesHash, 'actual delivered references'),
    }, ...(Object.prototype.hasOwnProperty.call(r, 'runtimeEntityReferences') ? { runtimeEntityReferences: parseTtrpgOpenRuntimeEntityReferencesV1(r.runtimeEntityReferences) } : {}) }
  if (body.runtimeEntityReferences && body.runtimeEntityReferences.runtimeSourceHash !== body.runtimeSourceHash) p.fail('局势实例引用不属于原冻结来源')
  return { row: r, body }
}
function disclosureIdentity(value: Record<string, unknown>, templateHash: string) {
  if (value.templateHash !== templateHash) p.fail('采用身份、披露版本或原始授权不一致')
  return { viewerKey: p.key(value.viewerKey, 'actual human requester'), seatKey: p.key(value.seatKey, 'actual requester seat'),
    authorizationHash: p.hash(value.authorizationHash, 'actual acceptance authorization'), templateHash }
}
export function parseTtrpgOpenSessionSituationReceiptV1(value: unknown): TtrpgOpenSessionSituationReceiptV1 {
  const { row, body } = parseCommon(value)
  const disclosure = p.record(row.disclosure, ['kind', 'viewerKey', 'seatKey', 'authorizationHash', 'templateHash', 'scope'], 'human situation disclosure')
  return { ...body, version: p.literal(row.version, 1, 'session situation version'), disclosure: {
    kind: p.literal(disclosure.kind, 'human-gm-reviewed', 'human disclosure kind'), ...disclosureIdentity(disclosure, body.templateHash),
    scope: p.literal(disclosure.scope, 'player-and-discovery-text-reviewed', 'explicit player/discovery text disclosure') } }
}
/** Versioned reader preserves V1 exactly; V2 cannot claim human review or omit its original once grant. */
export function parseTtrpgOpenSessionSituationReceiptV2(value: unknown): TtrpgOpenSessionSituationReceipt {
  const r = p.object(value, 'versioned session situation receipt')
  if (r.version === 1) return parseTtrpgOpenSessionSituationReceiptV1(value)
  const { row, body } = parseCommon(value)
  const disclosure = p.record(row.disclosure, ['kind', 'viewerKey', 'seatKey', 'authorizationHash', 'templateHash', 'scope',
    'gmSeatKey', 'gmSeatRevision', 'authorization'], 'AI host once disclosure')
  const authorization = parseTtrpgOpenPublicSituationAuthorizationV1(disclosure.authorization), basis = authorization.basis
  if (basis.delegation.decision !== 'adopt-this-one-candidate' || basis.sessionKey !== body.sourceRef.sessionKey
    || basis.authorizationEpochKey !== body.model.epochKey || basis.requestKey !== body.model.requestKey
    || basis.requester.viewerKey !== disclosure.viewerKey || basis.requester.seatKey !== disclosure.seatKey
    || basis.runtimeSourceHash !== body.runtimeSourceHash || authorization.run.contractHash !== body.model.runContractHash
    || basis.sourceVisibilityHash !== body.model.contextHash || body.authorizationRef.sequence !== basis.readEvidence.sequence + 1) p.fail('AI 主持采用缺少本次原请求的准确一次委托')
  return { ...body, version: p.literal(row.version, 2, 'AI host situation version'), disclosure: {
    kind: p.literal(disclosure.kind, 'ai-host-once-authorized', 'AI host once disclosure kind'), ...disclosureIdentity(disclosure, body.templateHash),
    scope: p.literal(disclosure.scope, 'this-one-common-candidate', 'AI host once scope'),
    gmSeatKey: p.key(disclosure.gmSeatKey, 'actual AI GM seat'), gmSeatRevision: p.integer(disclosure.gmSeatRevision, 'actual AI GM revision', 1, Number.MAX_SAFE_INTEGER), authorization } }
}

/** The shared registered-root parser owns the exact identity grammar and canonical set order. */
export function parseTtrpgOpenSituationArtifactRefsV1(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 1000) p.fail('已采用局势必须保留有界的真实逐字证据引用')
  return extractExactArtifactOwnerRootsV1({ refsJson: JSON.stringify(value) }, [{ field: 'refsJson', path: [] }])
}
