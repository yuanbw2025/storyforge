import type { TtrpgOpenCommonOracleArchiveReceiptV1 } from './open-common-oracle-archive-contract'
/** Exact one-call request evidence. Parsing, hashing or source matching never grants live authority. */
import * as p from './open-contract-parse'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenOracleRuntimeReferencePolicyV1, verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1, type TtrpgOpenOracleRuntimeReferencePolicyV1 } from './open-runtime-entity-references'
import { projectTtrpgOpenOracleRuntimeIdentityScopeV1 } from './open-oracle-runtime-delivery'
import { canonicalStringify as stable, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import type { loadTtrpgOpenCommonOracleContextV1 } from './open-common-oracle-context'

export const TTRPG_OPEN_COMMON_ORACLE_SKILL_V1 = 'prose.ttrpg-open-common-oracle-interpret'
export const TTRPG_OPEN_COMMON_ORACLE_STEP_V1 = 'ttrpg.open.common-oracle-interpret'
export const TTRPG_OPEN_COMMON_ORACLE_ENTRY_V1 = 'ttrpg.open.common-oracle-interpret'
export const TTRPG_OPEN_COMMON_ORACLE_INPUT_V1 = '明确解释本次选定且全体接收者可读的原 Oracle；仅用实际交付的共同资料拟定事实，逐项由真人另行审阅。'
export const TTRPG_OPEN_COMMON_ORACLE_REQUEST_POLICY_V1 = Object.freeze({
  purpose: 'common-oracle-fact-candidate' as const, decision: 'request-this-one-common-oracle-candidate' as const,
  maximumCalls: 1 as const, maximumAiActions: 0 as const, perFactHumanReviewRequired: true as const,
  parsingEvidenceGrantsNoLiveAuthority: true as const,
})
export function parseTtrpgOpenCommonOracleRequestBasisV1(value: unknown) {
  const r = p.record(value, ['schema', 'version', 'purpose', 'sessionKey', 'runtimeSourceHash', 'rulePackContentHash',
    'authorizationRevision', 'requester', 'readEvidence', 'oracleSourceRef', 'audience', 'recipientActorKeys',
    'oracleInputHash', 'sourceVisibilityHash', 'runtimeReferencePolicy', 'decision', 'modelIdentity', 'budget'], 'common Oracle request basis')
  const requester = p.record(r.requester, ['viewerKey', 'seatKey', 'seatRevision'], 'common Oracle requester')
  const read = p.record(r.readEvidence, ['sequence', 'stateHash'], 'common Oracle source cut')
  const model = p.record(r.modelIdentity, ['provider', 'model'], 'common Oracle model')
  const budget = p.record(r.budget, ['maximumInputTokens', 'maximumOutputTokens', 'maximumCostUsd', 'maximumCalls', 'maximumAiActions', 'perFactHumanReviewRequired'], 'common Oracle budget')
  const version = p.integer(r.version,'common Oracle request version',1,2) as 1 | 2
  const recipientActorKeys = p.keys(r.recipientActorKeys, 'common Oracle actual recipients', 1000, 1)
  if (stable(recipientActorKeys) !== stable([...recipientActorKeys].sort())) p.fail('共同事实接收者须按实际角色排序')
  const sessionKey = p.key(r.sessionKey, 'common Oracle session'), oracleSourceRef = parseTtrpgOpenSourceRefV1(r.oracleSourceRef)
  const sequence = p.integer(read.sequence, 'common Oracle source sequence', 1), audience = p.oneOf(r.audience, ['public', 'party'], 'common Oracle audience')
  const runtimeSourceHash = p.hash(r.runtimeSourceHash, 'common Oracle frozen source'), rulePackContentHash = p.hash(r.rulePackContentHash, 'common Oracle rules')
  const runtimeReferencePolicy = r.runtimeReferencePolicy === null ? null : parseTtrpgOpenOracleRuntimeReferencePolicyV1(r.runtimeReferencePolicy)
  if (oracleSourceRef.sessionKey === sessionKey && oracleSourceRef.sequence > sequence) p.fail('共同事实不能借用未来咨询')
  if (runtimeReferencePolicy && (runtimeReferencePolicy.audience !== audience || stable(runtimeReferencePolicy.oracleSourceRef) !== stable(oracleSourceRef)
    || stable(runtimeReferencePolicy.recipientActorKeys) !== stable(recipientActorKeys) || runtimeReferencePolicy.references.runtimeSourceHash !== runtimeSourceHash
    || runtimeReferencePolicy.references.rulePackContentHash !== rulePackContentHash
    || runtimeReferencePolicy.references.references.some(row => row.sourceRef.sessionKey === sessionKey && row.sourceRef.sequence > sequence))) p.fail('共同事实实例范围不属于本次原咨询、接收者或冻结来源')
  if (typeof model.provider !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(model.provider)) p.fail('共同事实模型 provider 无效')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-common-oracle-request-basis', 'common Oracle request schema'),
    version, purpose: p.literal(r.purpose, TTRPG_OPEN_COMMON_ORACLE_REQUEST_POLICY_V1.purpose, 'common Oracle purpose'),
    sessionKey, runtimeSourceHash, rulePackContentHash, authorizationRevision: p.integer(r.authorizationRevision, 'common Oracle authorization revision', 1),
    requester: { viewerKey: p.key(requester.viewerKey, 'common Oracle human viewer'), seatKey: p.key(requester.seatKey, 'common Oracle human seat'), seatRevision: p.integer(requester.seatRevision, 'common Oracle seat revision', 1) },
    readEvidence: { sequence, stateHash: p.hash(read.stateHash, 'common Oracle original head') }, oracleSourceRef, audience, recipientActorKeys,
    oracleInputHash: p.hash(r.oracleInputHash, 'common Oracle full selected body'), sourceVisibilityHash: p.hash(r.sourceVisibilityHash, 'common Oracle original source visibility'),
    runtimeReferencePolicy, decision: p.literal(r.decision, TTRPG_OPEN_COMMON_ORACLE_REQUEST_POLICY_V1.decision, 'common Oracle explicit decision'),
    modelIdentity: { provider: model.provider, model: p.text(model.model, 'common Oracle model name', 200) },
    // V1 bytes keep their original ceiling. V2 is structural only: live admission
    // still binds the actual frozen epoch, model, output and complete wire budget.
    budget: { maximumInputTokens: p.integer(budget.maximumInputTokens, 'common Oracle input limit', 1, version === 1 ? 16000 : 1_000_000), maximumOutputTokens: p.integer(budget.maximumOutputTokens, 'common Oracle output limit', 1, 20000),
      maximumCostUsd: p.number(budget.maximumCostUsd, 'common Oracle cost limit', 0, 1000), maximumCalls: p.literal(budget.maximumCalls, 1, 'common Oracle call limit'),
      maximumAiActions: p.literal(budget.maximumAiActions, 0, 'common Oracle action limit'), perFactHumanReviewRequired: p.literal(budget.perFactHumanReviewRequired, true, 'common Oracle human review') } }
}
export type TtrpgOpenCommonOracleRequestBasisV1 = ReturnType<typeof parseTtrpgOpenCommonOracleRequestBasisV1>
export async function hashTtrpgOpenCommonOracleRequestBasisV1(value: unknown) {
  const basis = parseTtrpgOpenCommonOracleRequestBasisV1(value)
  if (basis.runtimeReferencePolicy) await verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1(basis.runtimeReferencePolicy)
  return hashCanonicalValue(basis)
}
type Source = Awaited<ReturnType<typeof loadTtrpgOpenCommonOracleContextV1>>
/** Only matches immutable source evidence. The eventual command must separately recheck live owner, original cut, budget and window. */
export async function assertTtrpgOpenCommonOracleRequestSourceV1(value: unknown, source: Source) {
  const basis = parseTtrpgOpenCommonOracleRequestBasisV1(value)
  await hashTtrpgOpenCommonOracleRequestBasisV1(basis)
  const entry = source.directory.find(row => stable(row.oracleSourceRef) === stable(basis.oracleSourceRef))
  const bodies = source.resources.filter(row => row.suffix === entry?.suffix)
  if (!entry || bodies.length !== 1 || entry.audience !== basis.audience || entry.contentHash !== basis.oracleInputHash
    || source.readEvidence.sessionKey !== basis.sessionKey || source.readEvidence.runtimeSourceHash !== basis.runtimeSourceHash
    || source.readEvidence.sequence < basis.readEvidence.sequence
    || source.readEvidence.sequence === basis.readEvidence.sequence && source.readEvidence.stateHash !== basis.readEvidence.stateHash
    || source.visibilityHash !== await hashCanonicalValue(source.resources)
    || source.authorizationRevision !== basis.authorizationRevision || stable(source.recipientActorKeys) !== stable(basis.recipientActorKeys)
    || source.visibilityHash !== basis.sourceVisibilityHash || entry.snapshotHash !== (basis.runtimeReferencePolicy?.references.snapshotHash ?? null)
    || await sha256Text(stable(bodies[0].value)) !== basis.oracleInputHash) p.fail('共同事实请求的原咨询、实际完整正文或来源范围已变化')
  const packet = p.object(bodies[0].value, 'common Oracle actual source body')
  const contract = p.object(source.resources.find(row => row.suffix === 'common-oracle-contract')?.value, 'common Oracle actual contract')
  if (contract.rulePackContentHash !== basis.rulePackContentHash || stable(packet.runtimeIdentityScope) !== stable(basis.runtimeReferencePolicy ? projectTtrpgOpenOracleRuntimeIdentityScopeV1(basis.runtimeReferencePolicy) : null)) p.fail('共同事实请求的实际规则或原实例正文不匹配')
  return basis
}
/** Pure preparation from already verified source/seat evidence; does not create an epoch or Run. */
export async function createTtrpgOpenCommonOracleRequestBasisV1(input: {
  version?: 1 | 2
  source: Source; oracleSourceRef: TtrpgOpenSourceRefV1; requester: TtrpgOpenCommonOracleRequestBasisV1['requester'];
  runtimeReferencePolicy: TtrpgOpenOracleRuntimeReferencePolicyV1 | null; decision: TtrpgOpenCommonOracleRequestBasisV1['decision'];
  modelIdentity: TtrpgOpenCommonOracleRequestBasisV1['modelIdentity']; budget: TtrpgOpenCommonOracleRequestBasisV1['budget'];
}) {
  const { source } = input, row = source.directory.find(row => stable(row.oracleSourceRef) === stable(input.oracleSourceRef))
  if (!row) p.fail('共同事实请求必须明确选择本次共同可读的原咨询')
  const contract = p.object(source.resources.find(row => row.suffix === 'common-oracle-contract')?.value, 'common Oracle source contract')
  const basis = parseTtrpgOpenCommonOracleRequestBasisV1({ schema: 'storyforge.ttrpg-open-common-oracle-request-basis', version: input.version ?? 1,
    purpose: TTRPG_OPEN_COMMON_ORACLE_REQUEST_POLICY_V1.purpose, sessionKey: source.readEvidence.sessionKey, runtimeSourceHash: source.readEvidence.runtimeSourceHash,
    rulePackContentHash: contract.rulePackContentHash, authorizationRevision: source.authorizationRevision, requester: input.requester,
    readEvidence: { sequence: source.readEvidence.sequence, stateHash: source.readEvidence.stateHash }, oracleSourceRef: row.oracleSourceRef, audience: row.audience,
    recipientActorKeys: source.recipientActorKeys, oracleInputHash: row.contentHash, sourceVisibilityHash: source.visibilityHash,
    runtimeReferencePolicy: input.runtimeReferencePolicy, decision: input.decision, modelIdentity: input.modelIdentity, budget: input.budget })
  return assertTtrpgOpenCommonOracleRequestSourceV1(basis, source)
}

/** Immutable original local Run proof. Historical physical ids are provenance, never remapped execution authority. */
export function parseTtrpgOpenCommonOracleAuthorizationV1(value: unknown) {
  const row = p.record(value, ['basis', 'basisHash', 'worldTurn', 'run', 'inputArtifactHash', 'admissionStateHash', 'authorizationCommandId', 'reservationCommandId', 'epochKey', 'requestKey'], 'common Oracle window evidence')
  const run = p.record(row.run, ['runId', 'contractHash', 'contractJson'], 'common Oracle original Run')
  if (typeof run.contractJson !== 'string' || !run.contractJson || run.contractJson.length > 1_000_000) p.fail('共同事实原 Run 合同字节为空或过长')
  return { worldTurn: p.integer(row.worldTurn, 'common Oracle original world turn', 0), basis: parseTtrpgOpenCommonOracleRequestBasisV1(row.basis), basisHash: p.hash(row.basisHash, 'common Oracle original basis hash'),
    run: { runId: p.integer(run.runId, 'common Oracle original Run id', 1), contractHash: p.hash(run.contractHash, 'common Oracle original contract hash'), contractJson: run.contractJson },
    inputArtifactHash: p.hash(row.inputArtifactHash, 'common Oracle authorization artifact'), admissionStateHash: p.hash(row.admissionStateHash, 'common Oracle original mechanics'),
    authorizationCommandId: p.key(row.authorizationCommandId, 'common Oracle authorize command'), reservationCommandId: p.key(row.reservationCommandId, 'common Oracle reserve command'),
    epochKey: p.key(row.epochKey, 'common Oracle original epoch'), requestKey: p.key(row.requestKey, 'common Oracle original request') }
}
export type TtrpgOpenCommonOracleAuthorizationV1 = ReturnType<typeof parseTtrpgOpenCommonOracleAuthorizationV1>
export function ttrpgOpenCommonOracleAuthorizationInputV1(grant: Omit<TtrpgOpenCommonOracleAuthorizationV1, 'run' | 'inputArtifactHash'>) {
  return { schema: 'storyforge.ttrpg-open-common-oracle-authorization-input', version: 1, basis: grant.basis, basisHash: grant.basisHash, worldTurn: grant.worldTurn,
    admissionStateHash: grant.admissionStateHash, authorizationCommandId: grant.authorizationCommandId, reservationCommandId: grant.reservationCommandId, epochKey: grant.epochKey, requestKey: grant.requestKey }
}
/** Existing Harness portability policy cancels this local authority on import, even if every numeric id is reused. */
export function ttrpgOpenCommonOracleAuthorizationCheckpointV1(grant: Pick<TtrpgOpenCommonOracleAuthorizationV1, 'basisHash' | 'authorizationCommandId' | 'epochKey' | 'requestKey'>) {
  return { schema: 'storyforge.ttrpg-open-common-oracle-authorization-checkpoint', version: 1, portable: false,
    basisHash: grant.basisHash, authorizationCommandId: grant.authorizationCommandId, epochKey: grant.epochKey, requestKey: grant.requestKey }
}
export function ttrpgOpenCommonOracleObjectiveV1(basisHash: string, commandId: string) {
  return `共同事实原请求 ${p.hash(basisHash, 'common basis hash')} ${p.key(commandId, 'common authorize command')}`
}
export function readTtrpgOpenCommonOracleObjectiveV1(value: string) {
  const match = /^共同事实原请求 ([a-f0-9]{64}) ([A-Za-z0-9][A-Za-z0-9._:-]{0,199})$/.exec(value)
  return match ? { basisHash: match[1], authorizationCommandId: match[2] } : null
}
export async function ttrpgOpenCommonOracleInputRevisionV1(input: { basisHash: string; authorizationHash: string; viewerKey: string; authorizationCommandId: string }) {
  return hashCanonicalValue({ schema: 'storyforge.ttrpg-open-common-oracle-input-revision', version: 1, ...input })
}
export async function verifyTtrpgOpenCommonOracleEpochsV1(epochs: readonly { commonOracle?: TtrpgOpenCommonOracleAuthorizationV1; commonOracleArchive?: TtrpgOpenCommonOracleArchiveReceiptV1 }[]) {
  for (const epoch of epochs) if (epoch.commonOracle) {
    const grant = epoch.commonOracle
    if (epoch.commonOracleArchive) {
      const { receiptHash, ...body } = epoch.commonOracleArchive
      if (await hashCanonicalValue(body) !== receiptHash) p.fail('共同事实人工归档回执 hash 已损坏')
    }
    if (await hashTtrpgOpenCommonOracleRequestBasisV1(grant.basis) !== grant.basisHash
      || await hashCanonicalValue(p.json(grant.run.contractJson)) !== grant.run.contractHash) p.fail('共同事实窗口的原请求或原 Run 证据 hash 已损坏')
  }
}

export function ttrpgOpenCommonOracleCallMarkerV1(grant: Pick<TtrpgOpenCommonOracleAuthorizationV1, 'basis' | 'basisHash' | 'worldTurn'>) {
  return { worldTurn: grant.worldTurn, oracleSourceRef: grant.basis.oracleSourceRef, basisHash: grant.basisHash,
    ...(grant.basis.runtimeReferencePolicy ? { runtimeReferencePolicy: grant.basis.runtimeReferencePolicy } : {}) }
}
export function assertTtrpgOpenCommonOracleFactAudienceV1(grant: TtrpgOpenCommonOracleAuthorizationV1, audience: string, recipients: readonly string[]) {
  if (audience !== grant.basis.audience || stable([...recipients].sort()) !== stable(audience === 'party' ? grant.basis.recipientActorKeys : [])) p.fail('共同事实必须保持原咨询的准确共同范围，不能创造或扩大私域接收者')
}
export function parseTtrpgOpenCommonOracleRequestCloseV1(value: unknown) {
  const row = p.record(value, ['requestKey', 'decision'], 'common Oracle original request close')
  return { requestKey: p.key(row.requestKey, 'common Oracle close request'), decision: p.oneOf(row.decision,
    ['discard-this-common-oracle-request-and-close-window', 'close-this-reviewed-common-oracle-window'], 'common Oracle close decision') }
}
export type TtrpgOpenCommonOracleRequestCloseV1 = ReturnType<typeof parseTtrpgOpenCommonOracleRequestCloseV1>
