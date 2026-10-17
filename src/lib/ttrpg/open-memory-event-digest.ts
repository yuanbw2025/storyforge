import type { ProductRuntimeEvent } from '../types'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import type { TtrpgOpenMemorySourceEventV1 } from './open-memory-contract'

export async function ttrpgOpenMemoryEventDigestV1(event: ProductRuntimeEvent, sessionKey: string): Promise<TtrpgOpenMemorySourceEventV1> {
  const payload = JSON.parse(event.payloadJson)
  const payloadHash = await hash(payload)
  // This is the sole runtime payload FK rewritten by the registered backup adapter.
  // Preserve every other byte's meaning; an envelope pointing outside this owner is invalid.
  if (payload?.envelope && typeof payload.envelope === 'object' && 'sessionId' in payload.envelope) {
    if (payload.envelope.sessionId !== event.sessionId) throw new Error('[ttrpg-memory] 来源事件的实例定位越界')
    payload.envelope.sessionId = 0
  }
  return { sourceRef: { sessionKey, sequence: event.sequence }, type: event.type, payloadHash, portablePayloadHash: await hash(payload) }
}
