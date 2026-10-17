/** Shared durable terminal repair after a domain has proved its actual committed event. Never sends or writes product prose. */
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import type { ProductRuntimeEvent } from '../types'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { AgentRunStoreError, readInstanceAgentRunV1, appendAgentRunEventV1, appendRuntimeCandidateAdoptedV1 } from '../agent/run/event-store'
import { createVerificationReceiptV1, parseVerificationReceiptV1, verifyVerificationReceiptIntegrityV1 } from '../agent/run/verification-receipt'
import { AgentRunArtifactStoreError, recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../memory/artifact-store'

export async function finalizeTtrpgOpenRuntimeAdoptionV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }, args: {
  candidate: { rawResponseHash: string; inputManifestHash: string }; call: TtrpgOpenModelCallV1
  event: ProductRuntimeEvent & { commandId: string; baseSequence: number }
  adoptionHash: string; postStateHash: string; verifier: 'ttrpg-open-kp-v1' | 'ttrpg-open-brief-v1' | 'ttrpg-open-situation-propose-v1' | 'ttrpg-open-public-situation-propose-v2' | 'ttrpg-open-entity-plan-v2'
  verificationSchema: 'storyforge.ttrpg-kp-verification' | 'storyforge.ttrpg-brief-verification' | 'storyforge.ttrpg-situation-verification' | 'storyforge.ttrpg-public-situation-verification' | 'storyforge.ttrpg-entity-plan-verification'
  criteria: Parameters<typeof createVerificationReceiptV1>[0]['criteria']
  decisionAuthority?: { kind: string; sourceRef: TtrpgOpenSourceRefV1 }
}): Promise<string> {
  const { candidate, event, adoptionHash, postStateHash, verifier, decisionAuthority } = args
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const snapshot = await readInstanceAgentRunV1(input.scope, input.runId), call = args.call, step = snapshot.projection.steps[call.stepId]
      if (!step) throw new Error('[ttrpg-runtime-adoption] 运行步骤缺失')
      const append = (type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) => appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId, type, payload, expectedLastSequence: snapshot.projection.lastSequence } as Parameters<typeof appendAgentRunEventV1>[0])
      // Generic adopt status contains no human identity or review claim. Actual
      // authority is in the committed runtime receipt and exact verifier artifact.
      if (!step.confirmation) { await append('confirmation.recorded', { stepId: call.stepId, candidateHash: input.candidateHash, decision: 'adopt' }); continue }
      if (step.confirmation !== 'adopt') throw new Error('[ttrpg-runtime-adoption] 被拒绝候选不能补发采用回执')
      const adopted = snapshot.events.find(e => e.type === 'runtime.candidate.adopted' && e.payload.candidateHash === input.candidateHash)
      if (!adopted) { await appendRuntimeCandidateAdoptedV1({ scope: input.scope, runId: input.runId, expectedLastSequence: snapshot.projection.lastSequence, payload: { stepId: call.stepId, candidateHash: input.candidateHash, adoptionHash, commandIds: [event.commandId], baseSequence: event.baseSequence, resultingSequence: event.sequence } }); continue }
      if (adopted.type !== 'runtime.candidate.adopted' || adopted.payload.adoptionHash !== adoptionHash) throw new Error('[ttrpg-runtime-adoption] 已采用证据与实际叙述事件不一致')
      if (step.status !== 'succeeded') { await append('step.succeeded', { stepId: call.stepId, attempt: call.attempt, outputHash: adoptionHash }); continue }
      if (snapshot.projection.state === 'running') { await append('verification.started', { verifierSetVersion: verifier }); continue }
      if (!['verifying', 'completed'].includes(snapshot.projection.state)) throw new Error('[ttrpg-runtime-adoption] 运行不在可恢复终验状态')
      const receipt = await createVerificationReceiptV1({ version: 1, runId: input.runId, generation: snapshot.projection.generation, contractHash: snapshot.run.contractHash,
        contextManifestHashes: snapshot.events.filter(e => e.type === 'context.assembled' && e.payload.stepId === call.stepId).slice(-1).map(e => e.type === 'context.assembled' ? e.payload.manifestHash : candidate.inputManifestHash), candidateHashes: [input.candidateHash], adoptionEventIds: [], postStateHash, verifierSetVersion: verifier,
        criteria: args.criteria, acceptedAt: event.createdAt })
      let retained = false
      for (const e of snapshot.events) if (e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot') {
        const body = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'source-snapshot', contentHash: e.payload.contentHash })) as { schema?: string; adoptionHash?: string; receipt?: unknown;decisionAuthority?: unknown }
        if (body.schema !== args.verificationSchema) continue
        const saved = parseVerificationReceiptV1(body.receipt)
        if (body.adoptionHash !== adoptionHash || stable(body.decisionAuthority) !== stable(decisionAuthority) || !await verifyVerificationReceiptIntegrityV1(saved) || saved.receiptHash !== receipt.receiptHash) throw new Error('[ttrpg-runtime-adoption] 保存的终验工件与实际叙述或采用来源不一致')
        retained = true
      }
      if (!retained) { if (snapshot.projection.state === 'completed') throw new Error('[ttrpg-runtime-adoption] 完成运行缺少真实终验工件'); await recordAgentRunArtifactV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId, artifactKind: 'source-snapshot', content: JSON.stringify({ schema: args.verificationSchema, version: 1, adoptionHash,...(decisionAuthority ? { decisionAuthority } : {}),receipt }), stepId: call.stepId, attempt: call.attempt, expectedLastSequence: snapshot.projection.lastSequence }); continue }
      if (snapshot.projection.state === 'completed') { if (snapshot.projection.terminalReceiptHash !== receipt.receiptHash) throw new Error('[ttrpg-runtime-adoption] 终态 hash 不一致'); return receipt.receiptHash }
      await append('verification.accepted', { receiptHash: receipt.receiptHash })
    } catch (error) { if (!(error instanceof AgentRunStoreError && error.code === 'sequence_conflict') && !(error instanceof AgentRunArtifactStoreError && error.code === 'sequence-conflict')) throw error }
  }
  throw new Error('[ttrpg-runtime-adoption] 终验持续竞争，请恢复已保存叙述回执')
}
