/** Ordered complete event-prefix roots; a compact receipt never truncates a long stage to its last N events. */
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import type { ProductRuntimeEventType } from '../types'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import type { TtrpgOpenModelMemoryReceiptV2 } from './open-model-memory-contract'

export interface TtrpgOpenPortableMemoryEventV2 { sourceRef: TtrpgOpenSourceRefV1; type: ProductRuntimeEventType; portablePayloadHash?: string }
export async function ttrpgOpenMemoryPrefixRootsV2(sessionKey: string, events: readonly TtrpgOpenPortableMemoryEventV2[]) {
  let root = await hash({ schema: 'storyforge.ttrpg-memory-source-prefix', version: 2, sessionKey })
  const roots = new Map<number, string>()
  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    if (event.sourceRef.sessionKey !== sessionKey || event.sourceRef.sequence !== index + 1 || !event.portablePayloadHash) throw new Error('[ttrpg-memory] 长局来源必须有完整有序的可搬运原始事件证明')
    root = await hash({ previousRoot: root, sourceRef: event.sourceRef, type: event.type, portablePayloadHash: event.portablePayloadHash })
    roots.set(index + 1, root)
  }
  return roots
}
export function ttrpgOpenModelMemoryWindowBodyV2(receipt: Pick<TtrpgOpenModelMemoryReceiptV2, 'draft' | 'sourceRef' | 'runtimeSourceHash' | 'sourceLineageHash' | 'sourceWindow'>) {
  return { schema: 'storyforge.ttrpg-open-memory-source-window', version: 2, sessionKey: receipt.sourceRef.sessionKey,
    runtimeSourceHash: receipt.runtimeSourceHash, sourceLineageHash: receipt.sourceLineageHash, fromEventSequence: receipt.draft.fromEventSequence,
    toEventSequence: receipt.draft.toEventSequence, sourceWindow: receipt.sourceWindow }
}
