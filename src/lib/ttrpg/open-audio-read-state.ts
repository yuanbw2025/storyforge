import { verifyTtrpgOpenVoiceRequestsV1 } from './open-voice-request-proof'
/** Shared actual human read proof for audio and exact voice-script review. */
import type { WorkspaceScope } from '../types'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { readSessionEvents } from '../product/runtime-core'
import { verifyTtrpgOpenAudioReceiptsV1 } from './open-audio-proof'

export interface TtrpgOpenAudioReadInputV1 { scope: WorkspaceScope; sessionId: number; viewerKey: string }
export async function loadTtrpgOpenAudioReadStateV1(request: TtrpgOpenAudioReadInputV1) {
  const input = { scope: structuredClone(request.scope), sessionId: request.sessionId, viewerKey: request.viewerKey }
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const events = await readSessionEvents(loaded.session)
  await verifyTtrpgOpenAudioReceiptsV1({ runtime: loaded.runtime, runtimeSourceHash: loaded.session.runtimeSourceHash, events, projectId: input.scope.projectId })
  await verifyTtrpgOpenVoiceRequestsV1({ runtime: loaded.runtime, runtimeSourceHash: loaded.session.runtimeSourceHash, events })
  await loaded.assertCurrent(); return { ...loaded, events }
}
