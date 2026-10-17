import type { ProductRuntimeState, ProductRuntimeEvent } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { assertTtrpgOpenVoiceReservationV1, assertTtrpgOpenVoiceCancellationV1, parseTtrpgOpenVoiceRequestV1,
  ttrpgOpenVoiceReservationPayloadV1, ttrpgOpenVoiceCancellationPayloadV1 } from './open-voice-request-contract'
import * as p from './open-contract-parse'

export function applyTtrpgOpenVoiceRequestEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (!['ttrpg.audio.voice.reserved', 'ttrpg.audio.voice.cancelled'].includes(event.type)) return false
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.openRun || !runtime.authorization) p.fail('配音请求需要有效 open 团局')
  if (event.type === 'ttrpg.audio.voice.reserved') {
    const row = parseTtrpgOpenVoiceRequestV1(payload.request)
    if (row.sourceRef.sessionKey !== runtime.sessionKey || row.sourceRef.sequence !== event.sequence || row.readEvidence.sequence !== event.baseSequence
      || row.readEvidence.stateHash !== event.baseStateHash || stable(payload) !== stable(ttrpgOpenVoiceReservationPayloadV1(row))) p.fail('配音预留与原正式请求或基线不一致')
    assertTtrpgOpenVoiceReservationV1(runtime, row)
    runtime.openRun.voiceRequests = [...runtime.openRun.voiceRequests ?? [], row]
  } else {
    const intent = p.record(payload.intent, ['viewerKey', 'requestKey', 'decision'], 'voice cancellation intent')
    const viewerKey = p.key(intent.viewerKey, 'voice cancel viewer'), requestKey = p.key(intent.requestKey, 'voice cancel request')
    const row = assertTtrpgOpenVoiceCancellationV1(runtime, requestKey, viewerKey)
    const next = { ...row, cancelledRef: parseTtrpgOpenSourceRefV1(payload.cancellationRef) }
    if (next.cancelledRef.sessionKey !== runtime.sessionKey || next.cancelledRef.sequence !== event.sequence
      || stable(payload) !== stable(ttrpgOpenVoiceCancellationPayloadV1(next, viewerKey))) p.fail('配音取消与原准确请求不一致')
    runtime.openRun.voiceRequests = runtime.openRun.voiceRequests!.map(old => old.requestKey === requestKey ? next : old)
  }
  const issuer = runtime.authorization.seats.find(s => s.viewerKey === (payload.intent as ProductRuntimeJsonObjectV1).viewerKey)
  if (event.actorKey !== issuer?.actorKey || event.targetKey !== null) p.fail('配音事件发起席位不一致')
  state.ttrpg = runtime; return true
}
