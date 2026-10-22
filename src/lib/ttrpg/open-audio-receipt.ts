/** Single version dispatcher. Explicit V1 readers remain strict and preserve
 * old receipt/payload bytes; generated origin is carried only by explicit V2. */
import { parseTtrpgOpenAudioReceiptV1, parseTtrpgOpenAudioRequestV1, createTtrpgOpenAudioReceiptV1,
  ttrpgOpenAudioPayloadV1, assertTtrpgOpenAudioJournalV1, type TtrpgOpenAudioReceiptV1, type TtrpgOpenAudioRequestV1 } from './open-audio-contract'
import { parseTtrpgOpenAudioReceiptV2, parseTtrpgOpenAudioRequestV2, createTtrpgOpenAudioReceiptV2,
  type TtrpgOpenAudioReceiptV2, type TtrpgOpenAudioRequestV2, type TtrpgOpenGeneratedAudioOriginV1 } from './open-generated-audio-contract'
import { ttrpgOpenGeneratedAudioIdentityV1 } from './open-generated-audio-contract'
import * as p from './open-contract-parse'
export type TtrpgOpenAudioReceipt = TtrpgOpenAudioReceiptV1 | TtrpgOpenAudioReceiptV2
export type TtrpgOpenAudioRequest = TtrpgOpenAudioRequestV1 | TtrpgOpenAudioRequestV2
export function parseTtrpgOpenAudioReceipt(value: unknown): TtrpgOpenAudioReceipt {
  return value !== null && typeof value === 'object' && 'version' in value && value.version === 2
    ? parseTtrpgOpenAudioReceiptV2(value) : parseTtrpgOpenAudioReceiptV1(value)
}
export function parseTtrpgOpenAudioRequest(value: unknown): TtrpgOpenAudioRequest {
  return value !== null && typeof value === 'object' && 'version' in value && value.version === 2
    ? parseTtrpgOpenAudioRequestV2(value) : parseTtrpgOpenAudioRequestV1(value)
}
export function createTtrpgOpenAudioReceipt(input: Omit<Parameters<typeof createTtrpgOpenAudioReceiptV1>[0], 'request'> & {
  request: TtrpgOpenAudioRequest; generated?: TtrpgOpenGeneratedAudioOriginV1
}): TtrpgOpenAudioReceipt {
  if ('version' in input.request) {
    if (!input.generated || !input.asset) p.fail('生成配音缺少准确原来源或准备文件')
    return createTtrpgOpenAudioReceiptV2({...input, request: input.request, asset: input.asset, generated: input.generated})
  }
  if (input.generated !== undefined) p.fail('旧音轨不能借用生成来源')
  return createTtrpgOpenAudioReceiptV1({...input,request:input.request})
}
export function ttrpgOpenAudioPayload(receipt: TtrpgOpenAudioReceipt) {
  return receipt.version === 1 ? ttrpgOpenAudioPayloadV1(receipt) : {receipt, intent: {
    viewerKey: receipt.envelope.scope.issuerViewerKey, submissionKey: receipt.submissionKey, request: receipt.request,
    asset: receipt.asset, generated: receipt.generated, decision: 'confirm-this-audio-and-audience' }}
}
export function assertTtrpgOpenAudioJournal(runtime: Parameters<typeof assertTtrpgOpenAudioJournalV1>[0]) {
  assertTtrpgOpenAudioJournalV1(runtime, parseTtrpgOpenAudioReceipt)
  const adopted = new Set<string>()
  for (const row of runtime.openRun?.audioReceipts ?? []) if (row.version === 2 && row.request.media.kind === 'generated') {
    const identity = ttrpgOpenGeneratedAudioIdentityV1(row.generated)
    if (adopted.has(identity)) p.fail('同一原候选和接收范围存在重复的正式生成采用')
    adopted.add(identity)
  }
}
