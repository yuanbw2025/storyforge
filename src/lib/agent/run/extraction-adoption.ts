import Dexie, { type Table, type Transaction } from 'dexie'
import { db } from '../../db/schema'
import type { WorkspaceScope } from '../../types'
import { parseAgentRunEventV1 } from './event-schema'
import {
  appendAgentRunEventWithSettlementInTransactionV1,
  readVerifiedAgentRunInTransactionV1, withAgentRunMutationLockV1, type AgentRunSnapshotV1,
} from './event-store'
import { hashCanonicalValue } from './hash'

export class ExtractionEvidenceStaleError extends Error {}

const transactionHashTails = new WeakMap<Transaction, Promise<string>>()

export function hashExtractionValueV1(value: unknown): Promise<string> {
  let transaction = Dexie.currentTransaction
  if (!transaction) return hashCanonicalValue(value)
  while (transaction.parent) transaction = transaction.parent
  // Concurrent waitFor calls that settle out of order can stop the shared
  // keep-alive with an unresolved callback still queued. Serialize only the
  // external digests; database reads remain in their original transaction.
  const prior = transactionHashTails.get(transaction)
  const digest = Dexie.Promise.resolve(prior).then(() =>
    Dexie.waitFor(Dexie.ignoreTransaction(() => hashCanonicalValue(value))),
  )
  transactionHashTails.set(transaction, digest)
  return digest
}

export function withExtractionSourceTransactionV1<T>(
  tables: Table[],
  verifySources: () => Promise<unknown>,
  apply: () => Promise<T>,
): Promise<T> {
  return db.transaction('rw', tables, async () => {
    await Dexie.Promise.resolve(verifySources())
    return Dexie.Promise.resolve(apply())
  })
}

export function acceptExtractionReceiptV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  tables: Table[]
  verifySources: () => Promise<unknown>
  verifyPostState: () => Promise<void>
  receiptHash: string
}): Promise<AgentRunSnapshotV1> {
  const { scope, snapshot, receiptHash } = input
  return withAgentRunMutationLockV1(snapshot.run.id, () => withExtractionSourceTransactionV1(
    [...input.tables, db.agentRuns, db.agentRunEvents], input.verifySources, async () => {
      const current = await Dexie.Promise.resolve(readVerifiedAgentRunInTransactionV1(scope, snapshot.run.id))
      if (current.projection.lastSequence !== snapshot.projection.lastSequence) {
        throw new Error('提取运行已被其它执行者推进，请刷新后重试。')
      }
      await Dexie.Promise.resolve(input.verifyPostState())
      const event = parseAgentRunEventV1({
        version: 1, runId: current.run.id, sequence: current.projection.lastSequence + 1,
        generation: current.projection.generation, projectId: current.run.projectId,
        worldGroupId: current.run.worldGroupId ?? null, contractHash: current.run.contractHash,
        type: 'verification.accepted', payload: { receiptHash }, createdAt: Date.now(),
      })
      return Dexie.Promise.resolve(appendAgentRunEventWithSettlementInTransactionV1({ scope, snapshot: current, event }))
    },
  ))
}
