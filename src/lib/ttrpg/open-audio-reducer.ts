import type { ProductRuntimeState, ProductRuntimeEvent } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { createTtrpgOpenAudioReceiptV1, parseTtrpgOpenAudioReceiptV1, parseTtrpgOpenAudioRequestV1 } from './open-audio-contract'
import * as p from './open-contract-parse'

export function applyTtrpgOpenAudioEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type !== 'ttrpg.audio.cue.applied') return false
  p.exact(payload, ['receipt', 'intent'], 'audio event payload')
  const intent = p.record(payload.intent, ['viewerKey', 'submissionKey', 'request', 'asset', 'decision'], 'audio intent')
  p.literal(intent.decision, 'confirm-this-audio-and-audience', 'audio explicit decision')
  p.key(intent.submissionKey, 'audio control submission')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.authorization || !runtime.openRun) p.fail('正式音频仅适用于有效 open 团局')
  const receipt = parseTtrpgOpenAudioReceiptV1(payload.receipt), request = parseTtrpgOpenAudioRequestV1(intent.request)
  const viewerKey = p.key(intent.viewerKey, 'audio actual host'), seat = runtime.authorization.seats.find(row => row.viewerKey === viewerKey)
  const expected = createTtrpgOpenAudioReceiptV1({ runtime, runtimeSourceHash: receipt.runtimeSourceHash, viewerKey, request,
    asset: receipt.asset, sequence: event.sequence, commandId: event.commandId!, submissionKey: p.key(intent.submissionKey, 'audio submission') })
  if (!seat || event.actorKey !== seat.actorKey || event.targetKey !== request.privateActorKey || stable(intent.asset) !== stable(receipt.asset)
    || stable(expected) !== stable(receipt)) p.fail('音频事件与真实本人、来源或原请求不一致')
  runtime.openRun.audioReceipts = [...(runtime.openRun.audioReceipts ?? []), receipt]; state.ttrpg = runtime
  return true
}
