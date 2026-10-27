/** Closed memory receipt generations; old manual bytes remain unchanged. */
import { parseTtrpgOpenMemoryReceiptV1, ttrpgOpenMemoryIntentV1, type TtrpgOpenMemoryReceiptV1 } from './open-memory-contract'
import { parseTtrpgOpenModelMemoryReceiptV2, type TtrpgOpenModelMemoryReceiptV2 } from './open-model-memory-contract'
export type TtrpgOpenMemoryReceipt = TtrpgOpenMemoryReceiptV1 | TtrpgOpenModelMemoryReceiptV2
export function parseTtrpgOpenMemoryReceipt(value: unknown): TtrpgOpenMemoryReceipt {
  return value !== null && typeof value === 'object' && 'version' in value && value.version === 2
    ? parseTtrpgOpenModelMemoryReceiptV2(value) : parseTtrpgOpenMemoryReceiptV1(value)
}
export function ttrpgOpenMemoryIntent(receipt: TtrpgOpenMemoryReceipt) {
  return receipt.version === 1 ? ttrpgOpenMemoryIntentV1(receipt) : {
    viewerKey: receipt.viewerKey, origin: receipt.origin, requestKey: receipt.model.requestKey, candidateHash: receipt.model.candidateHash }
}
