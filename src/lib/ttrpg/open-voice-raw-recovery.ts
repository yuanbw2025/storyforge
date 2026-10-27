/** Explicit recovery of original raw bookkeeping only. Never infer or adopt. */
import { AgentRunStoreError, appendAgentRunEventV1, readInstanceAgentRunV1 } from '../agent/run/event-store'
import { createAgentRunCheckpointV1, beginAgentRunRecoveryV1, completeAgentRunRecoveryV1 } from '../agent/run/checkpoint'
import { AgentRunArtifactStoreError, recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import profile from '../../../scripts/ttrpg-local-tts/product-profile.json'
import { TTRPG_OPEN_VOICE_CONTROL_SCHEMA_V1, type TtrpgOpenVoiceControlV1 } from './open-voice-execution'
import { TTRPG_OPEN_VOICE_EXECUTION_STEP_V1 as stepId } from './open-voice-execution-input'
import type { TtrpgOpenVoiceJobLocatorV1 } from './open-voice-job-read-state'
import { createTtrpgOpenVoiceJobControllerV1, type TtrpgOpenVoiceJobControllerV1 } from './open-voice-job-controller'
import { loadTtrpgOpenVoiceRawBasisForKernelV1 } from './open-voice-raw-basis'
import * as p from './open-contract-parse'

type Request = TtrpgOpenVoiceJobLocatorV1 & { decision: 'recover-this-original-local-voice-raw-without-resending'; signal?: AbortSignal }
export async function recoverTtrpgOpenLocalVoiceRawForKernelV1(request: Request, controller: TtrpgOpenVoiceJobControllerV1) {
  const input = { scope: structuredClone(request.scope), sessionId: request.sessionId, viewerKey: request.viewerKey, requestKey: request.requestKey }, signal = request.signal
  p.literal(request.decision, 'recover-this-original-local-voice-raw-without-resending', 'explicit raw-only recovery')
  p.literal(controller.kind, 'original-local-voice-job-controller-v1', 'original raw controller')
  const retrieve = controller.recoverRaw.bind(controller)
  signal?.throwIfAborted()
  const first = await loadTtrpgOpenVoiceRawBasisForKernelV1(input)
  if (first.snapshot.projection.state === 'recovering' && !first.controls.length) p.fail('原恢复阶段缺少产品控制证明，先保留同一检查点')
  const raw = first.raw?.content ?? await retrieve(structuredClone(first.identity), signal)
  if (typeof raw !== 'string' || !raw.length || new TextEncoder().encode(raw).byteLength > Math.ceil(profile.maxAudioBytes / 3) * 4 + 1048576) p.fail('原始返回为空或超出读取预算，不重发模型')
  const rawHash = await sha256Text(raw)
  for (let attempt = 0; attempt < 16; attempt++) {
    signal?.throwIfAborted()
    const b = await loadTtrpgOpenVoiceRawBasisForKernelV1(input), snapshot = b.snapshot, state = snapshot.projection.state
    if (b.identity.jobKey !== first.identity.jobKey || b.identity.inputArtifactHash !== first.identity.inputArtifactHash || b.identity.profileHash !== first.identity.profileHash) p.fail('原始返回不再属于准确原任务')
    if (b.raw && (b.raw.hash !== rawHash || b.raw.content !== raw)) p.fail('已有原始返回与本次正文冲突，不覆盖或重发')
    const rawControls = b.controls.filter(c => c.payload.action === 'recover-original-raw-only')
    if (rawControls.some(c => c.payload.action === 'recover-original-raw-only' && c.payload.expectedRawResponseHash !== rawHash)) p.fail('原取回证据绑定了另一份准确正文，保留原状')
    if (['running','awaiting_confirmation','completed'].includes(state) && b.raw && b.responded) {
      await b.original.owner.assertCurrent()
      return { status: 'raw-response-recorded' as const, runId: snapshot.run.id, jobKey: b.jobKey, inputArtifactHash: b.inputArtifactHash,
        responseArtifactHash: rawHash, manifestHash: b.manifestHash, runState: state, retrievedFromLocalJob: !first.raw,
        candidateAccepted: false as const, adoptionAllowed: false as const, automaticRetryAllowed: false as const }
    }
    if (state === 'completed') p.fail('已完成的原 Run 缺少真实返回证据，不能借恢复补造')
    try {
      const owner = { scope: input.scope, productRuntimeSessionId: input.sessionId, runId: snapshot.run.id }
      if (state === 'recovering') {
        if (!b.controls.length) p.fail('恢复中缺少原控制屏障，不能扩大动作')
        const plan = await beginAgentRunRecoveryV1({ ...owner, expectedLastSequence: snapshot.projection.lastSequence })
        await completeAgentRunRecoveryV1({ ...owner, checkpointHash: plan.checkpointHash, expectedLastSequence: plan.snapshot.projection.lastSequence }); continue
      }
      if (!rawControls.length) {
        const marker: TtrpgOpenVoiceControlV1 = { schema: TTRPG_OPEN_VOICE_CONTROL_SCHEMA_V1, version: 1, action: 'recover-original-raw-only',
          jobKey: b.jobKey, inputArtifactHash: b.inputArtifactHash, expectedRawResponseHash: rawHash }
        await createAgentRunCheckpointV1({ ...owner, resumePayload: marker, expectedLastSequence: snapshot.projection.lastSequence }); continue
      }
      if (state === 'paused') {
        const plan = await beginAgentRunRecoveryV1({ ...owner, expectedLastSequence: snapshot.projection.lastSequence })
        await completeAgentRunRecoveryV1({ ...owner, checkpointHash: plan.checkpointHash, expectedLastSequence: plan.snapshot.projection.lastSequence }); continue
      }
      if (state !== 'running') p.fail('原语音不在允许补齐证据的运行状态')
      if (!b.raw) {
        await recordAgentRunArtifactV1({ ...owner, stepId, attempt: 1, artifactKind: 'raw-response', content: raw, expectedLastSequence: snapshot.projection.lastSequence }); continue
      }
      await appendAgentRunEventV1({ ...owner, type: 'model.responded', payload: { stepId, attempt: 1, outputHash: rawHash }, expectedLastSequence: snapshot.projection.lastSequence })
    } catch (error) {
      if (error instanceof AgentRunArtifactStoreError && error.code === 'sequence-conflict') continue
      if (error instanceof AgentRunStoreError && ['sequence_conflict','checkpoint_stale'].includes(error.code)) continue
      if (error instanceof AgentRunStoreError && error.code === 'recovery_state'
        && (await readInstanceAgentRunV1(input.scope, snapshot.run.id)).projection.lastSequence !== snapshot.projection.lastSequence) continue
      throw error
    }
  }
  p.fail('原始返回记账持续竞争，请明确恢复同一任务；本次没有重发模型')
}
export function recoverTtrpgOpenLocalVoiceRawV1(request: Request) {
  return recoverTtrpgOpenLocalVoiceRawForKernelV1(request, createTtrpgOpenVoiceJobControllerV1())
}
