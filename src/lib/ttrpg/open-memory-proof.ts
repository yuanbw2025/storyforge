import { ttrpgOpenFrozenSourceHashV1 } from './open-release-continuation-proof'
/** Exact event-window evidence and portable ancestor proof; no database IDs enter the memory receipt. */
import type { ProductRuntimeEvent, ProductRuntimeSession } from '../types'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import type { TtrpgNarrativeMemoryV1 } from './narrative-memory'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { verifyTtrpgOpenBranchLineageV1 } from './open-branch-contract'
import { ttrpgOpenMemoryEventDigestV1 } from './open-memory-event-digest'
export { ttrpgOpenMemoryEventDigestV1 } from './open-memory-event-digest'
import type { TtrpgOpenMemorySourceEventV1, TtrpgOpenMemoryReceiptV1 } from './open-memory-contract'
import { parseTtrpgOpenMemoryReceipt, ttrpgOpenMemoryIntent, type TtrpgOpenMemoryReceipt } from './open-memory-receipt'
import { ttrpgOpenMemoryPrefixRootsV2, ttrpgOpenModelMemoryWindowBodyV2 } from './open-memory-prefix-proof'

export function ttrpgOpenMemoryWindowBodyV1(receipt: Pick<TtrpgOpenMemoryReceiptV1, 'draft' | 'sourceRef' | 'runtimeSourceHash' | 'sourceLineageHash' | 'sourceEvents'>) {
  return { schema: 'storyforge.ttrpg-open-memory-source-window', version: 1, sessionKey: receipt.sourceRef.sessionKey,
    runtimeSourceHash: receipt.runtimeSourceHash, sourceLineageHash: receipt.sourceLineageHash, fromEventSequence: receipt.draft.fromEventSequence,
    toEventSequence: receipt.draft.toEventSequence, sourceEvents: receipt.sourceEvents }
}
export function ttrpgOpenMemoryLineageBodyV1(sessionKey: string, runtimeSourceHash: string, ancestors: readonly { evidenceHash: string }[]) {
  return { schema: 'storyforge.ttrpg-open-memory-lineage', version: 1, sessionKey, runtimeSourceHash, ancestorEvidenceHashes: ancestors.map(a => a.evidenceHash) }
}
export async function verifyTtrpgOpenMemoryReceiptsV1(input: {
  runtime: TtrpgRuntimeStateV2; runtimeSourceHash: string; events: readonly ProductRuntimeEvent[]
}): Promise<void> {
  const receipts = input.runtime.openRun?.memoryReceipts ?? []
  if (input.runtime.branchLineage) await verifyTtrpgOpenBranchLineageV1(input.runtime.branchLineage, input.runtime.sessionKey)
  if (!receipts.length) return
  const localEvents = new Map(input.events.map(event => [event.sequence, event]))
  const localDigests = new Map<number, TtrpgOpenMemorySourceEventV1>()
  const prefixRoots = new Map<string, Map<number, string>>()
  for (const value of receipts) {
    const receipt = parseTtrpgOpenMemoryReceipt(value), { receiptHash, ...body } = receipt
    const ancestors = input.runtime.branchLineage?.ancestors ?? []
    const originIndex = ancestors.findIndex(a => a.sessionKey === receipt.sourceRef.sessionKey)
    const originAncestors = receipt.sourceRef.sessionKey === input.runtime.sessionKey ? ancestors : ancestors.slice(0, originIndex)
    if (receipt.sourceLineageHash !== await hash(ttrpgOpenMemoryLineageBodyV1(receipt.sourceRef.sessionKey, receipt.runtimeSourceHash, originAncestors))
      || receipt.runtimeSourceHash !== ttrpgOpenFrozenSourceHashV1(input.runtime, receipt.sourceRef, input.runtimeSourceHash) || receiptHash !== await hash(body)
      || receipt.derivedFromHash !== await hash(receipt.version === 1 ? ttrpgOpenMemoryWindowBodyV1(receipt) : ttrpgOpenModelMemoryWindowBodyV2(receipt))) throw new Error('[ttrpg-memory] 记忆或真实区间来源 hash 不一致')
    if (receipt.version === 2) {
      let roots = prefixRoots.get(receipt.sourceRef.sessionKey)
      if (!roots) {
        const through = receipts.reduce((maximum, value) => value.version === 2 && value.sourceRef.sessionKey === receipt.sourceRef.sessionKey ? Math.max(maximum, value.draft.toEventSequence) : maximum, 0)
        const originEvents = receipt.sourceRef.sessionKey === input.runtime.sessionKey
          ? await Promise.all(input.events.filter(event => event.sequence <= through).sort((a, b) => a.sequence - b.sequence).map(async event => {
            const digest = localDigests.get(event.sequence) ?? await ttrpgOpenMemoryEventDigestV1(event, input.runtime.sessionKey)
            localDigests.set(event.sequence, digest)
            return digest
          })) : ancestors.find(ancestor => ancestor.sessionKey === receipt.sourceRef.sessionKey)?.events.slice(0, through)
        if (!originEvents) throw new Error('[ttrpg-memory] 模型复盘缺少完整来源前缀')
        roots = await ttrpgOpenMemoryPrefixRootsV2(receipt.sourceRef.sessionKey, originEvents)
        prefixRoots.set(receipt.sourceRef.sessionKey, roots)
      }
      if (roots.get(receipt.draft.toEventSequence) !== receipt.sourceWindow.portableChainHash) throw new Error('[ttrpg-memory] 模型复盘原始事件前缀已变化或缺失')
    }
    const originalPayload = { commandId: receipt.commandId, memory: receipt, sourceLineageHash: receipt.sourceLineageHash, intent: ttrpgOpenMemoryIntent(receipt) }
    if (receipt.sourceRef.sessionKey === input.runtime.sessionKey) {
      const event = localEvents.get(receipt.sourceRef.sequence)
      if (!event || event.type !== 'ttrpg.memory.recorded' || event.commandId !== receipt.commandId || event.actorKey !== receipt.authorActorKey
        || stable(JSON.parse(event.payloadJson)) !== stable(originalPayload)) throw new Error('[ttrpg-memory] 记忆缺少原始确认事件')
      for (const expected of receipt.version === 1 ? receipt.sourceEvents : []) {
        const raw = localEvents.get(expected.sourceRef.sequence)
        if (!raw) throw new Error('[ttrpg-memory] 原始区间事件缺失')
        const actual = localDigests.get(raw.sequence) ?? await ttrpgOpenMemoryEventDigestV1(raw, input.runtime.sessionKey)
        localDigests.set(raw.sequence, actual)
        if (actual.type !== expected.type || actual.portablePayloadHash !== expected.portablePayloadHash) throw new Error('[ttrpg-memory] 原始区间内容已改变')
      }
    } else {
      const ancestor = input.runtime.branchLineage?.ancestors.find(a => a.sessionKey === receipt.sourceRef.sessionKey)
      const event = ancestor?.events[receipt.sourceRef.sequence - 1]
      if (!ancestor || ancestor.runtimeSourceHash !== receipt.runtimeSourceHash || !event || event.type !== 'ttrpg.memory.recorded'
        || event.payloadHash !== await hash(originalPayload)
        || !ancestor.snapshot.openRun?.memoryReceipts?.some(r => stable(r) === stable(receipt))) throw new Error('[ttrpg-memory] 记忆未在祖先切点前被真实确认')
      for (const expected of receipt.version === 1 ? receipt.sourceEvents : []) {
        const actual = ancestor.events[expected.sourceRef.sequence - 1]
        if (!actual || actual.type !== expected.type || actual.payloadHash !== expected.payloadHash
          && actual.portablePayloadHash !== expected.portablePayloadHash) throw new Error('[ttrpg-memory] 祖先没有保留确切记忆区间')
      }
    }
  }
}
export function projectTtrpgOpenMemoryRowV1(receipt: TtrpgOpenMemoryReceipt, session: ProductRuntimeSession,
  sourceSessionId: number | null = null): TtrpgNarrativeMemoryV1 {
  if (!session.id || !session.worldId || !session.workId) throw new Error('[ttrpg-memory] 记忆缺少当前实例 owner')
  return { ...receipt.draft, projectId: session.projectId, worldGroupId: session.worldGroupId ?? null,
    worldId: session.worldId, workId: session.workId, sessionId: session.id, sourceSessionId,
    derivedFromHash: receipt.derivedFromHash, stale: false, updatedAt: receipt.recordedAt }
}
export function assertTtrpgOpenMemoryLocatorV1(receipt: TtrpgOpenMemoryReceipt, source: ProductRuntimeSession | undefined, owner: ProductRuntimeSession): void {
  if (!source || source.kind !== 'ttrpg' || source.projectId !== owner.projectId || source.worldId !== owner.worldId || source.workId !== owner.workId
    || source.runtimeSourceHash !== receipt.runtimeSourceHash || JSON.parse(source.initialStateJson).ttrpg?.sessionKey !== receipt.sourceRef.sessionKey) throw new Error('[ttrpg-memory] 本地来源定位与原实例不一致')
}
