/** Historical proof may be checked internally without disclosing unrevealed GM prose or kernel state. */
import type { WorkspaceScope } from '../types'
import { assertTtrpgOpenSituationRequesterV1 } from './open-generated-situation-candidate'
import { ttrpgOpenSessionSituationActorAccessV1 } from './open-session-situation-catalog'
import { verifyTtrpgOpenSessionSituationHashesV1 } from './open-session-situation-proof'
import { parseTtrpgOpenRunOriginV1 } from './open-run-portability'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { canonicalStringify as stable, hashCanonicalValue as hash } from '../agent/run/hash'
import { verifyContextManifestIntegrityV2 } from '../agent/run/context-manifest'
import { verifyTtrpgOpenPublicSituationKernelV1, type TtrpgOpenPublicSituationKernelV1 } from './open-public-situation-kernel'
import { reviewTtrpgOpenDeliveredPublicSituationV1 } from './open-public-situation-delivery'
import type { TtrpgOpenPublicSituationCandidateV1 } from './open-public-situation-candidate'
import type { TtrpgOpenInputEvidenceV1 } from './open-input-evidence'

export async function readTtrpgOpenPublicSessionSituationAuditV1(input: { scope: WorkspaceScope; sessionId: number; viewerKey: string; templateKey: string }) {
  try {
    const loaded = await assertTtrpgOpenSituationRequesterV1(input), run = loaded.runtime.openRun!
    const receipt = run.situationReceipts?.find(row => row.template.templateKey === input.templateKey)
    if (receipt?.version !== 2 || !loaded.seat?.actorKey || !ttrpgOpenSessionSituationActorAccessV1(run, input.templateKey, loaded.seat.actorKey)) throw new Error('scope')
    await verifyTtrpgOpenSessionSituationHashesV1([receipt])
    const origin = await parseTtrpgOpenRunOriginV1(receipt.runOriginJson), bodies = new Map<string, string>()
    for (const event of origin.events) {
      if (event.type !== 'evidence.artifact.recorded') continue
      const ref = event.payload, key = ref.artifactKind + ':' + ref.contentHash
      const content = bodies.get(key) ?? await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: ref.artifactKind, contentHash: ref.contentHash })
      if (new TextEncoder().encode(content).byteLength !== ref.byteLength) throw new Error('bytes')
      bodies.set(key, content)
    }
    const snapshots: unknown[] = [...bodies.entries()].filter(([key]) => key.startsWith('source-snapshot:')).map(([, body]) => JSON.parse(body))
    const candidates = snapshots.filter((row): row is TtrpgOpenPublicSituationCandidateV1 => Boolean(row && typeof row === 'object' && 'schema' in row && row.schema === 'storyforge.ttrpg-open-public-situation-candidate'))
    const inputs = snapshots.filter((row): row is TtrpgOpenInputEvidenceV1 => Boolean(row && typeof row === 'object' && 'schema' in row && row.schema === 'storyforge.ttrpg-open-input-evidence'))
      .filter(row => row.manifest.manifestHash === receipt.model.inputManifestHash)
    if (candidates.length !== 1 || inputs.length !== 1) throw new Error('unique-original')
    const candidate = candidates[0], evidence = inputs[0], { candidateHash, ...body } = candidate
    if (candidateHash !== receipt.model.candidateHash || await hash(body) !== candidateHash || candidate.runId !== origin.sourceRunId
      || candidate.productRuntimeSessionId !== origin.sourceSessionId || candidate.requestKey !== receipt.model.requestKey
      || candidate.viewerKey !== receipt.disclosure.viewerKey || candidate.epochKey !== receipt.model.epochKey
      || candidate.rawResponseHash !== receipt.model.rawResponseHash || candidate.inputManifestHash !== receipt.model.inputManifestHash
      || candidate.runtimeSourceHash !== receipt.runtimeSourceHash || candidate.admissionStateHash !== receipt.disclosure.authorization.admissionStateHash
      || candidate.review?.basisHash !== receipt.model.basisHash || candidate.visibilityHash !== receipt.model.contextHash
      || evidence.manifest.runId !== origin.sourceRunId || evidence.manifest.scope.projectId !== origin.sourceProjectId
      || evidence.manifest.scope.workspaceUid !== origin.workspaceUid || evidence.manifest.scope.worldCode !== origin.worldCode
      || evidence.manifest.scope.workCode !== origin.workCode || !await verifyContextManifestIntegrityV2(evidence.manifest)) throw new Error('binding')
    const kernelBody = bodies.get('source-snapshot:' + evidence.publicKernelHash)
    if (!kernelBody || !evidence.publicKernelHash) throw new Error('original-kernel')
    const kernel = await verifyTtrpgOpenPublicSituationKernelV1({ snapshot: JSON.parse(kernelBody) as TtrpgOpenPublicSituationKernelV1,
      expectedHash: evidence.publicKernelHash, grant: receipt.disclosure.authorization, sessionKey: origin.sessionKey,
      epochKey: receipt.model.epochKey, authorizationHash: receipt.disclosure.authorizationHash })
    const reads = evidence.preflight.artifacts.filter(ref => ref.role === 'source-snapshot').map(ref => {
      const source = bodies.get(ref.artifactKind + ':' + ref.contentHash)
      if (!source) throw new Error('original-read')
      return { sourceKey: ref.sourceKey, resourceKey: ref.resourceKey, content: JSON.parse(source).content }
    })
    const raw = bodies.get('raw-response:' + receipt.model.rawResponseHash)
    if (raw === undefined) throw new Error('original-response')
    const actual = await reviewTtrpgOpenDeliveredPublicSituationV1({ value: JSON.parse(raw), snapshot: kernel, reads })
    if (stable(actual.review) !== stable(candidate.review) || stable(actual.references) !== stable(candidate.references)
      || actual.review.proposalHash !== receipt.model.proposalHash || await hash(actual.references) !== receipt.model.referencesHash
      || stable(actual.review.proposal.template) !== stable(receipt.template)) throw new Error('original-candidate')
    await loaded.assertCurrent()
    return { schema: 'storyforge.ttrpg-open-public-situation-audit' as const, version: 1 as const,
      historical: true as const, grantsSend: false as const, grantsAcceptance: false as const,
      authority: 'ai-host-once-authorized' as const, receiptHash: receipt.receiptHash, templateKey: receipt.template.templateKey,
      title: receipt.template.title, sourceRef: receipt.sourceRef, authorizationRef: receipt.authorizationRef,
      originalRequestKey: receipt.model.requestKey, originalCandidateHash: receipt.model.candidateHash,
      originalSharedBasisHash: receipt.disclosure.authorization.basisHash }
  } catch { throw new Error('当前不能核验该共同局势的完整原始采用记录；未授予发送、采用或私域正文读取权限。') }
}
