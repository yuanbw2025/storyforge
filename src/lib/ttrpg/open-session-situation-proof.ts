/** Integrity of persisted definitions; original raw/delivered candidate proof is checked at adoption. */
import { parseTtrpgOpenSituationArtifactRefsV1, type TtrpgOpenSessionSituationReceipt } from './open-session-situation-contract'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { hashTtrpgOpenPublicSituationRequestBasisV1 } from './open-public-situation-request'
import { ttrpgOpenPublicSituationAuthorizationInputV1, assertTtrpgOpenPublicSituationOriginalScopeV1 } from './open-public-situation-authorization-contract'
import { verifyTtrpgOpenRuntimeEntityReferencesHashV1 } from './open-runtime-entity-references'
export async function verifyTtrpgOpenSessionSituationHashesV1(receipts: readonly TtrpgOpenSessionSituationReceipt[]) {
  for (const receipt of receipts) {
    if (receipt.runtimeEntityReferences) await verifyTtrpgOpenRuntimeEntityReferencesHashV1(receipt.runtimeEntityReferences)
    const { receiptHash, ...body } = receipt
    if (await hashCanonicalValue(body) !== receiptHash || await hashCanonicalValue(receipt.template) !== receipt.templateHash
      || await hashCanonicalValue({ schema: 'storyforge.ttrpg-open-situation-proposal', version: 1,
        template: receipt.template, personalizationSourceKeys: receipt.personalizationSourceKeys }) !== receipt.model.proposalHash
      || receipt.template.templateKey !== 'generated.' + (await hashCanonicalValue({ sessionKey: receipt.sourceRef.sessionKey, proposalKey: receipt.model.epochKey })).slice(0, 40)) {
      throw new Error('已采用局势的原始身份、正文或采用回执已经损坏。')
    }
    const origin = await (await import('./open-run-portability')).parseTtrpgOpenRunOriginV1(receipt.runOriginJson)
    const contract = JSON.parse(origin.contractJson) as { executionBindings?: Array<{ skillId: string }> }
    const expectedSkill = receipt.version === 2 ? 'prose.ttrpg-open-public-situation-propose' : 'prose.ttrpg-open-situation-propose'
    if (contract.executionBindings?.[0].skillId !== expectedSkill) throw new Error('局势采用权限与原始请求用途不一致。')
    if (receipt.version === 2) {
      const grant = receipt.disclosure.authorization
      assertTtrpgOpenPublicSituationOriginalScopeV1(grant, receipt.sourceRef.sessionKey)
      if (origin.version !== 1 || origin.sourceRunId !== grant.run.runId || origin.sourceProjectId !== grant.basis.scope.projectId
        || origin.sourceSessionId !== grant.basis.scope.sessionId || origin.contractJson !== grant.run.contractJson
        || contract.executionBindings?.[0].skillId !== 'prose.ttrpg-open-public-situation-propose'
        || await hashTtrpgOpenPublicSituationRequestBasisV1(grant.basis) !== grant.basisHash
        || await hashCanonicalValue(ttrpgOpenPublicSituationAuthorizationInputV1(grant)) !== grant.inputArtifactHash
        || !origin.events.some(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot'
          && e.payload.contentHash === grant.inputArtifactHash)) throw new Error('AI 主持采用缺少原共同请求的一次委托及实际输入证据。')
    }
    const refs = parseTtrpgOpenSituationArtifactRefsV1(origin.events.flatMap(e => e.type === 'evidence.artifact.recorded'
      ? [{ artifactKind: e.payload.artifactKind, contentHash: e.payload.contentHash }] : []))
    if (origin.sessionKey !== receipt.sourceRef.sessionKey || origin.contractHash !== receipt.model.runContractHash
      || canonicalStringify(refs) !== canonicalStringify(receipt.artifactRefs)
      || !origin.events.some(e => e.type === 'candidate.persisted' && e.payload.candidateHash === receipt.model.candidateHash)
      || !origin.events.some(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response' && e.payload.contentHash === receipt.model.rawResponseHash)) {
      throw new Error('已采用局势缺少准确的原始 Run、候选或回答证据。')
    }
  }
}
