/** One immutable human decision tied to an already-created original Run. No live rights from parsing. */
import { parseTtrpgOpenPublicSituationRequestBasisV1 } from './open-public-situation-request'
import * as p from './open-contract-parse'

export const TTRPG_OPEN_PUBLIC_SITUATION_SKILL_V1 = 'prose.ttrpg-open-public-situation-propose'
export const TTRPG_OPEN_PUBLIC_SITUATION_STEP_V1 = 'ttrpg.open.public-situation-propose'
export const TTRPG_OPEN_PUBLIC_SITUATION_ENTRY_V1 = 'ttrpg.open.public-situation-propose'
export const TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1 = 'request-public-situation'
export function ttrpgOpenPublicSituationObjectiveV1(basisHash: string, commandId: string) {
  return `共同局势原请求 ${p.hash(basisHash, 'public basis hash')} ${p.key(commandId, 'public authorization command')}`
}
export function readTtrpgOpenPublicSituationObjectiveV1(value: string) {
  const match = /^共同局势原请求 ([a-f0-9]{64}) ([A-Za-z0-9][A-Za-z0-9._:-]{0,199})$/.exec(value)
  return match ? { basisHash: match[1], authorizationCommandId: match[2] } : null
}

export function parseTtrpgOpenPublicSituationAuthorizationV1(value: unknown) {
  const r = p.record(value, ['schema', 'version', 'basis', 'basisHash', 'inputArtifactHash', 'admissionStateHash',
    'run', 'modelIdentity', 'budget', 'authorizationCommandId', 'reservationCommandId'], 'public situation authorization')
  const run = p.record(r.run, ['runId', 'contractHash', 'contractJson'], 'original public situation Run')
  const model = p.record(r.modelIdentity, ['provider', 'model'], 'public model identity')
  const budget = p.record(r.budget, ['maximumInputTokens', 'maximumOutputTokens', 'maximumCostUsd'], 'public request budget')
  if (typeof model.provider !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(model.provider)) p.fail('public model provider: 无效身份')
  if (typeof run.contractJson !== 'string' || !run.contractJson || run.contractJson.length > 1_000_000) p.fail('public original contract: 字节为空或过长')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-public-situation-authorization', 'public authorization schema'),
    version: p.literal(r.version, 1, 'public authorization version'), basis: parseTtrpgOpenPublicSituationRequestBasisV1(r.basis),
    basisHash: p.hash(r.basisHash, 'public basis hash'), inputArtifactHash: p.hash(r.inputArtifactHash, 'public input artifact'),
    admissionStateHash: p.hash(r.admissionStateHash, 'public admission state'),
    run: { runId: p.integer(run.runId, 'original public Run id', 1, Number.MAX_SAFE_INTEGER),
      contractHash: p.hash(run.contractHash, 'original public Run hash'), contractJson: run.contractJson },
    modelIdentity: { provider: model.provider, model: p.text(model.model, 'public model', 200) },
    budget: { maximumInputTokens: p.integer(budget.maximumInputTokens, 'public input budget', 1, 1_000_000),
      maximumOutputTokens: p.integer(budget.maximumOutputTokens, 'public output budget', 1, 1_000_000),
      maximumCostUsd: p.number(budget.maximumCostUsd, 'public cost limit', 0, 1000) },
    authorizationCommandId: p.key(r.authorizationCommandId, 'public authorization command'),
    reservationCommandId: p.key(r.reservationCommandId, 'public reservation command') }
}
export type TtrpgOpenPublicSituationAuthorizationV1 = ReturnType<typeof parseTtrpgOpenPublicSituationAuthorizationV1>

/** Original physical ids are immutable provenance across backup remapping. Pure replay
 * checks them against the original contract; live commands separately require the current
 * actual scope, exact local Run, authority and original artifact/transaction evidence. */
export function assertTtrpgOpenPublicSituationOriginalScopeV1(grant: TtrpgOpenPublicSituationAuthorizationV1, sessionKey: string) {
  const contract = p.object(p.json(grant.run.contractJson), 'original public contract')
  const scope = p.object(contract.scope, 'original public contract scope'), runtime = p.object(scope.runtime, 'original public runtime scope')
  const basis = grant.basis
  if (basis.sessionKey !== sessionKey || scope.projectId !== basis.scope.projectId || runtime.productRuntimeSessionId !== basis.scope.sessionId
    || runtime.baseSequence !== basis.readEvidence.sequence || runtime.stateHash !== basis.readEvidence.stateHash
    || runtime.releaseHash !== basis.runtimeSourceHash || runtime.visibilityHash !== basis.sourceVisibilityHash) p.fail('共同局势原始作用域与原契约不一致')
}

/** The exact original input artifact. Runtime identity/contract are bound after this body is hashed. */
export function ttrpgOpenPublicSituationAuthorizationInputV1(grant: Omit<TtrpgOpenPublicSituationAuthorizationV1, 'inputArtifactHash' | 'run' | 'schema' | 'version'>) {
  return { schema: 'storyforge.ttrpg-open-public-situation-authorization-input', version: 1,
    basis: grant.basis, basisHash: grant.basisHash, admissionStateHash: grant.admissionStateHash,
    modelIdentity: grant.modelIdentity, budget: grant.budget,
    authorizationCommandId: grant.authorizationCommandId, reservationCommandId: grant.reservationCommandId }
}
