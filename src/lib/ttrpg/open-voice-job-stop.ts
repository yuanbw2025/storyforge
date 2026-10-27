/** Durable inference barrier first, explicit stop second. No guessed closure. */
import { AgentRunStoreError, appendAgentRunEventV1 } from '../agent/run/event-store'
import { createAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { loadTtrpgOpenVoiceJobReadStateForKernelV1, type TtrpgOpenVoiceJobLocatorV1 } from './open-voice-job-read-state'
import { TTRPG_OPEN_VOICE_CONTROL_SCHEMA_V1, readTtrpgOpenVoiceExecutionControlsForKernelV1, type TtrpgOpenVoiceControlV1 } from './open-voice-execution'
import { createTtrpgOpenVoiceJobControllerV1, type TtrpgOpenVoiceJobControllerV1 } from './open-voice-job-controller'
import * as p from './open-contract-parse'

type Request = TtrpgOpenVoiceJobLocatorV1 & { decision: 'stop-this-original-local-voice-execution'; signal?: AbortSignal }
export async function stopTtrpgOpenLocalVoiceJobForKernelV1(request: Request, controller: TtrpgOpenVoiceJobControllerV1) {
  const input = { scope: structuredClone(request.scope), sessionId: request.sessionId, viewerKey: request.viewerKey, requestKey: request.requestKey }, signal = request.signal
  p.literal(request.decision, 'stop-this-original-local-voice-execution', 'explicit original job stop')
  p.literal(controller.kind, 'original-local-voice-job-controller-v1', 'original job controller')
  const stop = controller.stop.bind(controller)
  signal?.throwIfAborted()
  const b = await loadTtrpgOpenVoiceJobReadStateForKernelV1(input, false)
  const execution = { scope: input.scope, sessionId: input.sessionId, runId: b.snapshot.run.id, inputArtifactHash: b.inputArtifactHash }
  let blocked = false
  for (let attempt = 0; attempt < 12; attempt++) {
    signal?.throwIfAborted()
    await b.original.owner.assertCurrent()
    const current = await readTtrpgOpenVoiceExecutionControlsForKernelV1(execution), state = current.snapshot.projection.state
    if (!current.controls.length && !['completed','failed','cancelled','recovery_required'].includes(state)) {
      if (state === 'recovering') p.fail('原恢复检查点尚无控制屏障，保留原恢复证据并停止扩大动作')
      const payload: TtrpgOpenVoiceControlV1 = { schema: TTRPG_OPEN_VOICE_CONTROL_SCHEMA_V1, version: 1, action: 'stop-original-job', jobKey: b.jobKey, inputArtifactHash: b.inputArtifactHash }
      try { await createAgentRunCheckpointV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: execution.runId,
        resumePayload: payload, expectedLastSequence: current.snapshot.projection.lastSequence }); continue }
      catch (error) { if (error instanceof AgentRunStoreError && error.code === 'sequence_conflict') continue; throw error }
    }
    if (state === 'running' || state === 'awaiting_confirmation') {
      try { await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: execution.runId,
        type: 'run.paused', payload: { reason: '本人已请求停止原本机语音；是否实际关闭须按原 job 核查，原额度不返还。', recoverable: true }, expectedLastSequence: current.snapshot.projection.lastSequence }); continue }
      catch (error) { if (error instanceof AgentRunStoreError && error.code === 'sequence_conflict') continue; throw error }
    }
    blocked = true; break
  }
  if (!blocked) p.fail('原停止屏障持续竞争，请明确恢复同一停止动作，不重发模型')
  const beforeHttp = await loadTtrpgOpenVoiceJobReadStateForKernelV1(input, false)
  if (beforeHttp.jobKey !== b.jobKey || beforeHttp.inputArtifactHash !== b.inputArtifactHash) p.fail('停止前原任务身份已经变化')
  signal?.throwIfAborted()
  const backend = await stop({ jobKey: b.jobKey, inputArtifactHash: b.inputArtifactHash }, signal)
  const fresh = await loadTtrpgOpenVoiceJobReadStateForKernelV1(input, false)
  if (fresh.jobKey !== b.jobKey || fresh.inputArtifactHash !== b.inputArtifactHash) p.fail('停止响应不再属于原任务')
  const current = await readTtrpgOpenVoiceExecutionControlsForKernelV1(execution)
  return { requestKey: input.requestKey, runId: execution.runId, jobKey: b.jobKey, inputArtifactHash: b.inputArtifactHash,
    runState: current.snapshot.projection.state, runBarrierRecorded: current.controls.length > 0, futureInferenceBlocked: true as const,
    backend, cancellationConfirmed: backend.cancellationConfirmed, generationAllowed: false as const, adoptionAllowed: false as const, automaticRetryAllowed: false as const }
}
export function stopTtrpgOpenLocalVoiceJobV1(request: Request) {
  return stopTtrpgOpenLocalVoiceJobForKernelV1(request, createTtrpgOpenVoiceJobControllerV1())
}
