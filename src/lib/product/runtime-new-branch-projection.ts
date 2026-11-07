import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductRuntimeSession, ProductRuntimeState } from '../types'
import { stableProductRuntimeJsonV1 as stable } from './runtime-values'

/** Each kernel instance owns its insertion witnesses. No global registration
 * API or writable session handle escapes this closure. It only returns a
 * checked projection; actual session writes remain in runtime-core. */
export function createNewBranchProjectionAuthorityV1(dependencies: {
  parseState: (json: string) => ProductRuntimeState
  hashStateJson: (json: string) => Promise<string>
  readLatestSequence: (sessionId: number) => Promise<number>
}) {
  const insertedByTransaction = new WeakMap<NonNullable<typeof Dexie.currentTransaction>, Map<number, ProductRuntimeSession>>()
  return {
    recordNewInsert(session: ProductRuntimeSession): void {
      const transaction = Dexie.currentTransaction
      if (transaction?.mode !== 'readwrite' || session.id == null) return
      const inserted = insertedByTransaction.get(transaction) ?? new Map<number, ProductRuntimeSession>()
      inserted.set(session.id, structuredClone(session))
      insertedByTransaction.set(transaction, inserted)
    },
    async consume(input: {
      parent: ProductRuntimeSession; child: ProductRuntimeSession; throughSequence: number; state: ProductRuntimeState
    }): Promise<{ id: number; projection: Pick<ProductRuntimeSession,
      'initialStateJson' | 'runtimeHeadStateJson' | 'runtimeHeadStateHash'> }> {
      const expected = structuredClone(input.child), parent = structuredClone(input.parent)
      const stateJson = JSON.stringify(input.state), throughSequence = input.throughSequence
      const transaction = Dexie.currentTransaction
      const inserted = transaction && insertedByTransaction.get(transaction)
      const original = expected.id == null ? undefined : inserted?.get(expected.id)
      if (transaction?.mode !== 'readwrite' || !original || expected.id == null) {
        throw new Error('[runtime-branch] 投影只能在新实例的原创建事务内完成一次')
      }
      inserted!.delete(expected.id)
      const current = await db.productRuntimeSessions.get(expected.id)
      const currentParent = parent.id == null ? undefined : await db.productRuntimeSessions.get(parent.id)
      if (!current || !currentParent || stable(current) !== stable(expected)
        || stable(currentParent) !== stable(parent)
        || current.parentSessionId !== parent.id || current.parentThroughSequence !== throughSequence
        || !Number.isSafeInteger(throughSequence) || throughSequence < 0
        || current.worldId == null || current.workId == null
        || ['projectId', 'worldId', 'workId', 'worldGroupId', 'kind'].some(key =>
          current[key as keyof ProductRuntimeSession] !== parent[key as keyof ProductRuntimeSession])
        || (original.parentSessionId != null && original.parentSessionId !== parent.id)
        || (original.parentThroughSequence != null && original.parentThroughSequence !== throughSequence)
        || stable({ ...current, parentSessionId: original.parentSessionId,
          parentThroughSequence: original.parentThroughSequence }) !== stable(original)
        || current.runtimeHeadSequence !== 0 || dependencies.parseState(stateJson).lastSequence !== 0) {
        throw new Error('[runtime-branch] 新实例、父切点或初始投影已变化')
      }
      const parentHead = await dependencies.readLatestSequence(parent.id!)
      if (throughSequence > parentHead) throw new Error('[runtime-branch] 父切点超出已保存事件')
      return { id: expected.id, projection: { initialStateJson: stateJson, runtimeHeadStateJson: stateJson,
        runtimeHeadStateHash: await dependencies.hashStateJson(stateJson) } }
    },
  }
}
