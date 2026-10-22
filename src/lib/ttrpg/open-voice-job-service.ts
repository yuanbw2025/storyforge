/** Read-only original execution status. Backend availability is not permission. */
import { loadTtrpgOpenVoiceJobReadStateForKernelV1, type TtrpgOpenVoiceJobLocatorV1 } from './open-voice-job-read-state'
import { createTtrpgOpenVoiceJobReaderV1, type TtrpgOpenVoiceJobReaderV1 } from './open-voice-job-reader'
import * as p from './open-contract-parse'

export async function readTtrpgOpenLocalVoiceJobForKernelV1(request: TtrpgOpenVoiceJobLocatorV1 & { signal?: AbortSignal }, reader: TtrpgOpenVoiceJobReaderV1) {
  const input = { scope: structuredClone(request.scope), sessionId: request.sessionId, viewerKey: request.viewerKey, requestKey: request.requestKey }, signal = request.signal
  const kind = reader.kind, read = reader.read.bind(reader)
  p.literal(kind, 'original-local-voice-job-reader-v1', 'original job reader')
  signal?.throwIfAborted()
  const b = await loadTtrpgOpenVoiceJobReadStateForKernelV1(input)
  if (!b.identity) p.fail('原准确输入缺失，不能核查本机结果')
  signal?.throwIfAborted()
  const backend = await read(structuredClone(b.identity), signal)
  await b.original.owner.assertCurrent()
  // The child ledger or exact artifacts can change while HTTP is in flight
  // without changing the gameplay head. Reverify them and return its new state.
  const fresh = await loadTtrpgOpenVoiceJobReadStateForKernelV1(input)
  if (!fresh.identity || fresh.snapshot.run.id !== b.snapshot.run.id || fresh.identity.jobKey !== b.identity.jobKey
    || fresh.identity.inputArtifactHash !== b.identity.inputArtifactHash || fresh.identity.profileHash !== b.identity.profileHash) p.fail('原语音身份在查询期间已变化')
  signal?.throwIfAborted()
  return { requestKey: input.requestKey, runId: fresh.snapshot.run.id, runState: fresh.snapshot.projection.state,
    ...b.identity, backend, generationAllowed: false as const, adoptionAllowed: false as const, automaticRetryAllowed: false as const }
}
export async function readTtrpgOpenLocalVoiceJobV1(request: TtrpgOpenVoiceJobLocatorV1 & { signal?: AbortSignal }) {
  return readTtrpgOpenLocalVoiceJobForKernelV1(request, createTtrpgOpenVoiceJobReaderV1())
}
