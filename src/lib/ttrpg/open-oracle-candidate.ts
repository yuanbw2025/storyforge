/** Model-owned text stays a candidate. Only this closed proposal shape can enter fact validation. */
import type { CreativeArtifactV1 } from '../agent/creative-reliability'
import type { TtrpgOpenOracleFactProposalV1 } from './open-fact-ledger'
import { parseTtrpgOpenOracleFactProposalV1 } from './open-fact-ledger'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import type { TtrpgOpenFactPolicyV1, TtrpgOpenAudience } from './open-contract'
import { parseTtrpgOpenFactPolicyV1 } from './rule-pack-v2'
import * as p from './open-contract-parse'
import { parseStructuredOutputV1 } from '../agent/structured-output-pipeline'
import { readTtrpgOpenRuntimeCandidateV1, verifyTtrpgOpenRuntimeCandidateEvidenceV1, type TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { readProductRuntimeState } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { ttrpgOpenOracleRuntimeDeliveryPolicyV1 } from './open-oracle-runtime-delivery'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'

export interface TtrpgOpenOracleCandidateV1 {
  schema: 'storyforge.ttrpg-open-oracle-candidate'; version: 1; portable: false;
  runId: number; productRuntimeSessionId: number; requestKey: string; epochKey: string;
  actorKey: string; viewerKey: string; admissionStateHash: string; visibilityHash: string; runtimeSourceHash: string;
  inputManifestHash: string; rawResponseHash: string; oracleSourceRef: TtrpgOpenSourceRefV1;
  interpretation: string | null; facts: TtrpgOpenOracleFactProposalV1[] | null; artifact: CreativeArtifactV1; candidateHash: string;
  normalizationOf?: { sourceRef: TtrpgOpenSourceRefV1; reviewHash: string };
}
const rank: Record<TtrpgOpenAudience, number> = { public: 0, party: 1, private: 2, 'gm-only': 3 }
export function parseTtrpgOpenOracleSemanticCandidateV1(output: string, input: { contract: unknown; oracle: unknown }) {
  const value = parseStructuredOutputV1({ raw: output,
    contract: { version: 1, schemaId: 'storyforge.ttrpg-open-oracle-interpretation', target: 'runtime-candidate', root: 'object',
      maxChars: 120_000, allowedRootFields: ['interpretation', 'facts'], requiredRootFields: ['interpretation', 'facts'] }, parse: value => value })
  const root = p.record(value, ['interpretation', 'facts'], 'Oracle interpretation')
  const contract = p.object(input.contract, 'Oracle contract'), packet = p.object(input.oracle, 'Oracle input')
  p.literal(packet.schema, 'storyforge.ttrpg-open-gm-oracle-input', 'Oracle input schema')
  const runtimePolicy = ttrpgOpenOracleRuntimeDeliveryPolicyV1(contract, packet)
  return parseTtrpgOpenOracleSemanticFieldsV1(root, { contract, packet, runtimePolicy })
}
/** Shared semantic validation only; each source protocol must validate its own complete delivery first. */
export function parseTtrpgOpenOracleSemanticFieldsV1(root: Record<string, unknown>, input: {
  contract: Record<string, unknown>; packet: Record<string, unknown>; runtimePolicy: ReturnType<typeof ttrpgOpenOracleRuntimeDeliveryPolicyV1>;
}) {
  const { contract, packet, runtimePolicy } = input
  const sourceRef = parseTtrpgOpenSourceRefV1(packet.sourceRef)
  const audience = p.oneOf(packet.audience, ['public', 'party', 'gm-only'], 'Oracle input audience')
  const policies: TtrpgOpenFactPolicyV1[] = p.list(contract.factPolicy, 'Oracle fact policy', parseTtrpgOpenFactPolicyV1, 12, 12)
  const selectedActors = p.keys(contract.selectedActorKeys, 'Oracle selected actors', 1000)
  const entities = p.list(packet.permittedEntityRefs, 'Oracle input entities', value => p.object(value, 'Oracle permitted entity'), 10000)
  const sourceFacts = [...p.list(packet.permittedFrozenFacts, 'Oracle frozen facts', value => p.object(value, 'Oracle frozen fact'), 10000),
    ...p.list(packet.permittedSessionFacts, 'Oracle session facts', value => p.object(value, 'Oracle session fact'), 100000)]
  const sourceKeys = new Set(sourceFacts.map(fact => p.key(fact.factKey, 'Oracle source fact')))
  const entityKeys = new Set([...entities.map(entity => p.key(entity.entityRef, 'Oracle entity')),
    ...(runtimePolicy ? [] : sourceFacts.flatMap(fact => [fact.subjectRef, fact.objectRef].filter((ref): ref is string => typeof ref === 'string')))])
  const facts = p.list(root.facts, 'Oracle proposed facts', parseTtrpgOpenOracleFactProposalV1, 3)
  for (const fact of facts) {
    for (const key of [fact.subjectRef, fact.objectRef]) {
      const origin = runtimePolicy?.references.find(row => row.entityRef === key)
      if (origin && (!entities.some(row => row.entityRef === key && stable(row.runtimeOrigin) === stable(origin))
        || rank[fact.audience] < rank[origin.audience] || fact.audience !== 'gm-only' && origin.audience !== 'public'
          && fact.knownByActorKeys.some(actor => !origin.knownByActorKeys.includes(actor)))) p.fail('Oracle 实例事实超出实际读取的创建证据或准确接收者')
    }
    const policy = policies.find(policy => policy.predicateKey === fact.predicateKey)
    if (policy?.authority.session !== 'semantic-fact' || !entityKeys.has(fact.subjectRef) || (fact.objectRef !== null && !entityKeys.has(fact.objectRef))
      || fact.sourceFactRefs.some(ref => !sourceKeys.has(ref)) || rank[fact.audience] < rank[audience]
      || fact.knownByActorKeys.some(actor => !selectedActors.includes(actor))
      || (fact.audience === 'party' && [...fact.knownByActorKeys].sort().join(',') !== [...selectedActors].sort().join(','))
      || (['public', 'gm-only'].includes(fact.audience) && fact.knownByActorKeys.length)
      || entities.some(entity => entity.entityRef === fact.subjectRef && entity.playerControlled === true && ['knows', 'promised'].includes(fact.predicateKey))) {
      p.fail('Oracle 候选超出实际读取的主体/来源/语义 owner 或密级，不能替玩家决定或虚构知识')
    }
    for (const ref of fact.sourceFactRefs) {
      const source = sourceFacts.find(source => source.factKey === ref)!
      if (rank[fact.audience] < rank[p.oneOf(source.audience, p.AUDIENCES, 'Oracle fact source audience')]) p.fail('Oracle 事实不能降低实际来源密级')
      if (source.audience === 'private' && fact.audience === 'private') {
        const allowed = p.keys(source.knownByActorKeys ?? source.knownBy, 'Oracle private fact recipients', 1000)
        if (fact.knownByActorKeys.some(actor => !allowed.includes(actor))) p.fail('Oracle 事实不能扩大私人来源接收者')
      }
    }
  }
  return { oracleSourceRef: sourceRef, interpretation: p.text(root.interpretation, 'Oracle interpretation', 8000), facts }
}
export function parseTtrpgOpenFactNormalizationCandidateV1(output: string,input: { contract: unknown;oracle: unknown;review: unknown }) {
  const fields = parseStructuredOutputV1({ raw: output,contract: { version: 1,schemaId: 'storyforge.ttrpg-open-fact-normalization',target: 'runtime-candidate',
    root: 'object',maxChars: 120000,allowedRootFields: ['facts'],requiredRootFields: ['facts'] },parse: value => p.record(value,['facts'],'fact normalization output') })
  const review = p.object(input.review,'accepted interpretation')
  p.literal(review.schema,'storyforge.ttrpg-open-gm-fact-normalization-input','normalization input schema')
  const oracle = p.object(input.oracle, 'normalization original Oracle input')
  if (oracle.version === 2 || review.version === 2) {
    p.exact(review, ['schema', 'version', 'runtimeIdentityScope', 'sourceRef', 'reviewHash', 'oracleSourceRef', 'interpretation', 'audience', 'discardedProposals',
      'adoptedFactKeys', 'worldWriteBackForbidden', 'outputIsCandidate'], 'versioned normalization full source')
    if (review.version !== 2 || oracle.version !== 2 || stable(review.runtimeIdentityScope) !== stable(oracle.runtimeIdentityScope)
      || review.audience !== oracle.audience || review.worldWriteBackForbidden !== true || review.outputIsCandidate !== true) p.fail('实例归一缺少同一原解释与实际读取范围')
  }
  const candidate = parseTtrpgOpenOracleSemanticCandidateV1(JSON.stringify({ interpretation: review.interpretation,facts: fields.facts }),input)
  if (JSON.stringify(candidate.oracleSourceRef) !== JSON.stringify(parseTtrpgOpenSourceRefV1(review.oracleSourceRef))) p.fail('归一输入没有同一 Oracle 来源')
  const discarded = p.list(review.discardedProposals,'discarded source proposals',parseTtrpgOpenOracleFactProposalV1,3)
  const semanticTuple = (fact: TtrpgOpenOracleFactProposalV1) => JSON.stringify([fact.subjectRef,fact.predicateKey,fact.objectRef,fact.canonicalValue])
  if (candidate.facts.some(fact => discarded.some(rejected => semanticTuple(rejected) === semanticTuple(fact)))) p.fail('事实归一不能复活真人已弃用的同一事实')
  return { ...candidate,normalizationOf: { sourceRef: parseTtrpgOpenSourceRefV1(review.sourceRef),reviewHash: p.hash(review.reviewHash,'accepted interpretation hash') } }
}

export async function readTtrpgOpenOracleCandidateV1(input: TtrpgOpenCandidateReadV1): Promise<TtrpgOpenOracleCandidateV1 | null> {
  const candidate = await readTtrpgOpenRuntimeCandidateV1(input, 'oracle-interpret')
  return candidate?.schema === 'storyforge.ttrpg-open-oracle-candidate' ? candidate : null
}
export async function readTtrpgOpenFactNormalizationCandidateV1(input: TtrpgOpenCandidateReadV1): Promise<TtrpgOpenOracleCandidateV1 | null> {
  const candidate = await readTtrpgOpenRuntimeCandidateV1(input,'fact-normalize')
  return candidate?.schema === 'storyforge.ttrpg-open-oracle-candidate' ? candidate : null
}
export async function verifyTtrpgOpenOracleCandidateProofV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }) {
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const call = runtime?.openRun?.coordination.calls.find(call => call.requestKey === input.requestKey)
  const candidate = call?.skillId === 'prose.ttrpg-open-common-oracle-interpret'
    ? await (await import('./open-common-oracle-candidate')).readTtrpgOpenCommonOracleCandidateV1(input)
    : call?.skillId === 'prose.ttrpg-open-fact-normalize'
    ? await readTtrpgOpenFactNormalizationCandidateV1(input) : await readTtrpgOpenOracleCandidateV1(input)
  if (!candidate || candidate.candidateHash !== input.candidateHash || !candidate.interpretation || candidate.facts === null
    || !['ready', 'usable-with-warnings'].includes(candidate.artifact.status)) {
    throw new Error('[ttrpg-open-oracle] 候选需要修订、已受阻或不是本次确认的版本')
  }
  if (call?.supportSlot && (candidate.normalizationOf?.reviewHash !== call.supportSlot.sourceHash
    || JSON.stringify(candidate.normalizationOf.sourceRef) !== JSON.stringify(call.supportSlot.sourceRef))) p.fail('归一候选与冻结的已确认来源不一致')
  return { candidate, evidence: await verifyTtrpgOpenRuntimeCandidateEvidenceV1(input) }
}
