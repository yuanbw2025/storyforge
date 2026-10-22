/** Terminal proof of the human intent's actual committed event. This verifies
 * bookkeeping only; no Context Manifest, model result or adoption is invented. */
import type { WorkspaceScope } from '../types'
import { loadTtrpgOpenAudioReadStateV1 } from './open-audio-read-state'
import { TTRPG_OPEN_VOICE_REQUEST_STEP_V1 as stepId, ttrpgOpenVoiceReservationPayloadV1 } from './open-voice-request-contract'
import { verifyTtrpgOpenVoiceIntentRunV1 } from './open-voice-request-run'
import { parseProductRuntimeState, replayProductRuntimeEvents, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { AgentRunStoreError, readInstanceAgentRunV1, appendAgentRunEventV1 } from '../agent/run/event-store'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { AgentRunArtifactStoreError, recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import * as p from './open-contract-parse'

export async function finishTtrpgOpenVoiceIntentForKernelV1(input: { scope: WorkspaceScope; sessionId: number; viewerKey: string; requestKey: string }, readOnly = false) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const loaded = await loadTtrpgOpenAudioReadStateV1(input)
      const row = loaded.runtime.openRun!.voiceRequests?.find(r => r.requestKey === input.requestKey)
      if (!row || row.sourceRef.sessionKey !== loaded.runtime.sessionKey || row.script.scope.issuerViewerKey !== input.viewerKey || !loaded.humanHost || row.cancelledRef) p.fail('只能核验本人尚未取消的原本团配音意图')
      const proof = await verifyTtrpgOpenVoiceIntentRunV1({ ...input, row, phase: 'finalize' }), snapshot = proof.snapshot
      if (readOnly && snapshot.projection.state !== 'completed') p.fail('原配音意图尚未完成记账终验，请明确恢复；来源读取不会代替完成')
      const event = loaded.events.find(e => e.sequence === row.sourceRef.sequence)
      if (!event || event.type !== 'ttrpg.audio.voice.reserved' || event.createdAt < 0
        || canonicalStringify(JSON.parse(event.payloadJson)) !== canonicalStringify(ttrpgOpenVoiceReservationPayloadV1(row))) p.fail('缺少原配音预留的真实事件')
      const committed = replayProductRuntimeEvents(parseProductRuntimeState(loaded.session.initialStateJson), loaded.events.filter(e => e.sequence <= row.sourceRef.sequence))
      const committedRow = parseTtrpgRuntimeStateV2(committed.ttrpg)?.openRun?.voiceRequests?.find(r => r.requestKey === row.requestKey)
      if (canonicalStringify(committedRow) !== canonicalStringify(row)) p.fail('配音意图与原事件提交后的真实状态不一致')
      const postStateHash = await hashProductRuntimeStateV1(committed)
      const receipt = await createVerificationReceiptV1({ version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation,
        contractHash: snapshot.run.contractHash, contextManifestHashes: [], candidateHashes: [], adoptionEventIds: [], postStateHash,
        zeroModelCommit: { contractJson: snapshot.run.contractJson, inputArtifactHashes: [row.inputArtifactHash] },
        verifierSetVersion: 'ttrpg.open.voice-intent-v1', acceptedAt: event.createdAt,
        criteria: [{ id: 'voice.intent-recorded', status: 'passed', evidenceRefs: ['event:' + row.sourceRef.sessionKey + ':' + event.sequence, 'input:' + row.inputArtifactHash] }] })
      const content = canonicalStringify({ schema: 'storyforge.ttrpg-open-voice-intent-verification', version: 1, sourceRef: row.sourceRef, requestKey: row.requestKey, receipt })
      const artifactHash = await hashCanonicalValue(JSON.parse(content))
      await loaded.assertCurrent()
      const append = (type: 'step.succeeded' | 'verification.started' | 'verification.accepted', payload: unknown) => appendAgentRunEventV1({
        scope: input.scope, productRuntimeSessionId: input.sessionId, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence } as Parameters<typeof appendAgentRunEventV1>[0])
      const step = snapshot.projection.steps[stepId]
      if (step?.status === 'running') { await append('step.succeeded', { stepId, attempt: 1, outputHash: postStateHash }); continue }
      if (step?.status !== 'succeeded' || step.outputHash !== postStateHash) p.fail('原配音意图步骤与提交证据不一致')
      if (snapshot.projection.state === 'running') { await append('verification.started', { verifierSetVersion: 'ttrpg.open.voice-intent-v1' }); continue }
      if (!['verifying', 'completed'].includes(snapshot.projection.state)) p.fail('原配音意图不在可恢复的确定性终验状态')
      const recorded = snapshot.events.some(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot'
        && e.payload.contentHash === artifactHash && e.payload.stepId === stepId && e.payload.attempt === 1)
      if (!recorded) {
        if (snapshot.projection.state === 'completed') p.fail('完成的配音意图缺少真实终验工件')
        await recordAgentRunArtifactV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: snapshot.run.id,
          stepId, attempt: 1, artifactKind: 'source-snapshot', content, expectedLastSequence: snapshot.projection.lastSequence }); continue
      }
      if (await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'source-snapshot', contentHash: artifactHash }) !== content) p.fail('原配音意图终验正文已变化')
      if (snapshot.projection.state === 'completed') {
        if (snapshot.projection.terminalReceiptHash !== receipt.receiptHash) p.fail('原配音意图终态回执不一致')
        return { snapshot, receipt, artifactHash, request: row, owner: loaded }
      }
      await append('verification.accepted', { receiptHash: receipt.receiptHash })
    } catch (error) {
      if (!(error instanceof AgentRunStoreError && error.code === 'sequence_conflict') && !(error instanceof AgentRunArtifactStoreError && error.code === 'sequence-conflict')) throw error
    }
  }
  throw new Error('配音意图终验持续竞争，请恢复原记录；不会启动模型或重建预留')
}

/** Explicit recovery of bookkeeping, useful after a lost reserve return. */
export async function recoverTtrpgOpenVoiceIntentV1(request: { scope: WorkspaceScope; sessionId: number; viewerKey: string; requestKey: string; decision: 'verify-original-voice-intent-only' }) {
  p.literal(request.decision, 'verify-original-voice-intent-only', 'voice intent verification decision')
  const input = structuredClone(request), result = await finishTtrpgOpenVoiceIntentForKernelV1(input)
  const current = await readInstanceAgentRunV1(input.scope, result.snapshot.run.id)
  return { requestKey: input.requestKey, receiptHash: result.receipt.receiptHash, runState: current.projection.state, generationAllowed: false as const, adoptionAllowed: false as const }
}
