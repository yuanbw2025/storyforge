/** Reconcile model runs superseded by a real human narration; never send a request. */
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertInstanceBinding } from '../product/runtime-instances'
import { readProductRuntimeState } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { isTtrpgOpenModelNarrationReceiptV1, parseTtrpgOpenNarrationReceiptV1 } from './open-kp-receipt'
import { assertTtrpgOpenHumanHostV1, assertTtrpgOpenAuthorizationCurrentV1 } from './open-authorization'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { readTtrpgOpenKpCandidateV1 } from './open-kp-candidate'
import { readInstanceAgentRunV1, appendAgentRunEventV1, AgentRunStoreError } from '../agent/run/event-store'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1, AgentRunArtifactStoreError } from '../memory/artifact-store'
import { readTtrpgOpenModelCallRunsV1, verifyTtrpgOpenModelCallEvidenceV1 } from './open-model-call-evidence'
import { readTtrpgOpenImportedCallOwnerV1 } from './open-run-portability'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
export class TtrpgOpenHumanNarrationReceiptPendingError extends Error {
  readonly code = 'human-narration-committed-receipt-pending'
  constructor(readonly sessionId: number, readonly eventSequence: number, cause: unknown) { super(`人工叙述已保存，原候选的停止回执尚需补齐；不会重发模型。${cause instanceof Error ? cause.message : ''}`) }
}
type NarrationOwnerInput = { scope: WorkspaceScope; sessionId: number; viewerKey: string }
/** Exact owner selection for stopping a superseded KP Run only. Never a dispatch/adoption alias. */
async function narrationRequestOwner(input: NarrationOwnerInput, call: TtrpgOpenModelCallV1) {
  const physical = await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).toArray()
  if (physical.some(row => row.portableRuntimeOriginJson)) {
    const historical = await readTtrpgOpenImportedCallOwnerV1({ ...input, requestKey: call.requestKey })
    if (historical) return { runId: historical.runId, run: historical.evidence.run, origin: historical.origin }
  }
  const rows = await readTtrpgOpenModelCallRunsV1({ ...input, calls: [call] })
  const direct = rows.find(row => row.contractHash === call.runContractHash)
  if (direct?.id && !direct.portableRuntimeOriginJson) {
    await verifyTtrpgOpenModelCallEvidenceV1({ ...input, runId: direct.id, call, mode: 'finish' })
    return { runId: direct.id, run: direct, origin: null }
  }
  const historical = await readTtrpgOpenImportedCallOwnerV1({ ...input, requestKey: call.requestKey, ...(direct?.id ? { runId: direct.id } : {}) })
  return historical ? { runId: historical.runId, run: historical.evidence.run, origin: historical.origin } : null
}

/** Missing original evidence remains a visible repair; a terminal unrelated Run must never hide it. */
export async function readTtrpgOpenHumanNarrationRepairKeysV1(input: NarrationOwnerInput) {
  await assertInstanceBinding(input.sessionId, input.scope)
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  if (!runtime?.authorization || !runtime.openRun) return []
  assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization,
    participants: await readTtrpgSessionParticipantsV2(input.sessionId), viewerKey: input.viewerKey })
  try { assertTtrpgOpenHumanHostV1(runtime.authorization, input.viewerKey) } catch { return [] }
  const keys: string[] = []
  for (const receipt of runtime.openRun.narrations ?? []) {
    if (isTtrpgOpenModelNarrationReceiptV1(receipt) || receipt.binding.viewerKey !== input.viewerKey || receipt.sourceRef.sessionKey !== runtime.sessionKey) continue
    for (const previous of receipt.basis.previousRequests) {
      const call = runtime.openRun.coordination.calls.find(row => row.requestKey === previous.requestKey)
      let pending = true
      try {
        const owner = call ? await narrationRequestOwner(input, call) : null
        pending = !owner || !['failed', 'cancelled'].includes(owner.run.status)
      } catch { /* Keep the saved human prose visible. Explicit repair reports the exact evidence failure. */ }
      if (pending) { keys.push(receipt.binding.operationKey);break }
    }
  }
  return keys
}
export async function reconcileTtrpgOpenHumanNarrationV1(input: { scope: WorkspaceScope; sessionId: number; operationKey: string; viewerKey: string }) {
  await assertInstanceBinding(input.sessionId, input.scope)
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg), receipt = runtime?.openRun?.narrations?.find(r => r.binding.operationKey === input.operationKey)
  if (!runtime?.authorization || !receipt || isTtrpgOpenModelNarrationReceiptV1(receipt) || receipt.sourceRef.sessionKey !== runtime.sessionKey || receipt.binding.viewerKey !== input.viewerKey) throw new Error('缺少本人在本团局实际保存的人工叙述')
  assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization, participants: await readTtrpgSessionParticipantsV2(input.sessionId), viewerKey: input.viewerKey })
  assertTtrpgOpenHumanHostV1(runtime.authorization, input.viewerKey)
  const event = await db.productRuntimeEvents.where('[sessionId+sequence]').equals([input.sessionId, receipt.sourceRef.sequence]).first()
  if (!event || event.type !== 'ttrpg.open.narration.recorded' || stable(parseTtrpgOpenNarrationReceiptV1(JSON.parse(event.payloadJson).receipt)) !== stable(receipt)) throw new Error('人工叙述回执没有原始提交事件')
  for (const previous of receipt.basis.previousRequests) {
    const call = runtime.openRun!.coordination.calls.find(c => c.requestKey === previous.requestKey)
    if (!call || call.skillId !== 'prose.ttrpg-open-kp' || call.narrationBinding?.operationKey !== receipt.binding.operationKey
      || call.narrationBinding.viewerKey !== input.viewerKey || previous.status !== call.status
      || stable(previous.terminalRef) !== stable(call.terminalRef) || previous.responseArtifactHash !== call.responseArtifactHash) throw new Error('原模型记录已变化，不能伪造停止回执')
    let owner = await narrationRequestOwner(input, call)
    if (!owner) throw new Error('原模型缺少准确的运行与输入证明，人工叙述已保留，请找回原证据')
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        owner = await narrationRequestOwner(input, call)
        if (!owner) throw new Error('原模型运行证明已变化，不能完成替代回执')
        const snapshot = await readInstanceAgentRunV1(input.scope, owner.runId), step = snapshot.projection.steps[call.stepId]
        if (snapshot.projection.state === 'failed' || snapshot.projection.state === 'cancelled') break
        if (!step || step.confirmation === 'adopt' || snapshot.projection.state === 'completed') throw new Error('原模型已被采用，不能改写为人工替代')
        const candidate = owner.origin ? null : await readTtrpgOpenKpCandidateV1({ ...input, runId: owner.runId, requestKey: call.requestKey })
        const candidateHash = owner.origin && step.candidateHash && owner.origin.events.some(e => e.type === 'candidate.persisted'
          && e.payload.stepId === call.stepId && e.payload.attempt === call.attempt && e.payload.candidateHash === step.candidateHash)
          ? step.candidateHash : candidate?.candidateHash ?? null
        const content = canonicalStringify({ schema: 'storyforge.ttrpg-human-narration-replacement', version: 1, manualSourceRef: receipt.sourceRef, requestKey: call.requestKey,
          candidateHash, rawResponseHash: call.responseArtifactHash, ...(owner.origin ? { historicalOriginHash: owner.origin.originHash } : {}) }), contentHash = await hashCanonicalValue(JSON.parse(content))
        const retained = snapshot.events.some(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot' && e.payload.contentHash === contentHash)
        if (!retained) {
          await recordAgentRunArtifactV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: owner.runId, artifactKind: 'source-snapshot', content,
            stepId: call.stepId, attempt: call.attempt, expectedLastSequence: snapshot.projection.lastSequence });continue
        }
        if (await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'source-snapshot', contentHash }) !== content) throw new Error('人工替代的停止依据缺失或已变化')
        if (candidateHash && step.candidateHash === candidateHash && step.status === 'awaiting_confirmation' && !step.confirmation) {
          await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: owner.runId, type: 'confirmation.recorded',
            payload: { stepId: call.stepId, candidateHash, decision: 'reject' }, expectedLastSequence: snapshot.projection.lastSequence });continue
        }
        await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: owner.runId, type: 'run.failed', payload: { code: 'human-narration-replaced-model', retryable: false }, expectedLastSequence: snapshot.projection.lastSequence })
        break
      } catch (error) {
        if (!(error instanceof AgentRunStoreError && error.code === 'sequence_conflict') && !(error instanceof AgentRunArtifactStoreError && error.code === 'sequence-conflict')) throw error
        if (attempt === 11) throw new Error('原模型停止回执持续竞争，请读取已保存的人工叙述后重试')
      }
    }
    const terminal = await readInstanceAgentRunV1(input.scope, owner!.runId)
    if (!['failed', 'cancelled'].includes(terminal.projection.state)) throw new Error('原候选停止回执尚未完成，请重试已保存的人工叙述')
  }
}
