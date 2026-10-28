/**
 * WEH-0C · pending author edit barrier.
 *
 * UI drafts register a synchronous flusher while they are editable. Store writes
 * register their promise under a stable key. Formal generation calls flush() so
 * it cannot race ahead of blur/debounce persistence.
 */
import { maybeInjectHarnessFaultV1 } from '../agent/dev-fault-injection'

export interface PendingEditFlushReceiptV1 {
  version: 1
  draftFlushersInvoked: number
  writesAwaited: number
}

interface PendingWriteV1 {
  id: number
  key: string
  promise: Promise<unknown>
}

const draftFlushers = new Map<symbol, () => void | Promise<void>>()
const pendingWrites = new Map<number, PendingWriteV1>()
const writeTails = new Map<string, Promise<void>>()
const unresolvedFailures = new Map<string, { writeId: number; error: unknown }>()
let nextWriteId = 1

function message(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : String(error)
}

export function registerPendingDraftFlusherV1(
  flusher: () => void | Promise<void>,
): () => void {
  const id = Symbol('pending-author-draft')
  draftFlushers.set(id, flusher)
  return () => { draftFlushers.delete(id) }
}

/**
 * Serialize writes that target the same authoring record. A later successful
 * write clears an earlier failure for that key; until then every formal flush
 * keeps failing closed.
 */
export function coordinatePendingEditV1<T>(input: {
  key: string
  persist: () => Promise<T>
}): Promise<T> {
  const key = input.key.trim()
  if (!key) throw new Error('Pending edit key 不能为空')
  const previous = writeTails.get(key) ?? Promise.resolve()
  const operation = previous.catch(() => undefined).then(input.persist)
  const id = nextWriteId++
  pendingWrites.set(id, { id, key, promise: operation })
  const tail = operation.then(
    () => {
      unresolvedFailures.delete(key)
    },
    error => {
      unresolvedFailures.set(key, { writeId: id, error })
    },
  )
  writeTails.set(key, tail)
  const cleanup = () => {
    pendingWrites.delete(id)
    if (writeTails.get(key) === tail) writeTails.delete(key)
  }
  operation.then(cleanup, cleanup)
  // Store callers often intentionally fire-and-forget on blur. Attach a
  // rejection observer while keeping the returned promise rejectable.
  void operation.catch(() => undefined)
  return operation
}

export async function flushPendingEditsV1(): Promise<PendingEditFlushReceiptV1> {
  maybeInjectHarnessFaultV1('save.before-flush')
  const flushers = [...draftFlushers.values()]
  const draftResults = await Promise.allSettled(flushers.map(flusher => flusher()))
  const draftFailures = draftResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason)

  // A draft flusher may synchronously enqueue a store write, and a completed
  // write may enqueue another write. Continue until the registry is quiescent.
  const awaitedIds = new Set<number>()
  while (pendingWrites.size) {
    const batch = [...pendingWrites.values()]
    batch.forEach(item => awaitedIds.add(item.id))
    await Promise.allSettled(batch.map(item => item.promise))
    await Promise.resolve()
  }

  const failures = [...draftFailures, ...[...unresolvedFailures.values()].map(failure => failure.error)]
  if (failures.length) {
    throw new Error(`作者编辑保存失败，已阻止正式生成：${failures.map(message).join('；')}`)
  }
  maybeInjectHarnessFaultV1('save.after-flush')
  return {
    version: 1,
    draftFlushersInvoked: flushers.length,
    writesAwaited: awaitedIds.size,
  }
}

export interface PendingEditFailureTokenV1 { readonly key: string; readonly writeId: number }

/** A command may acknowledge only the exact rejected write it received.
 * Draft flushers still guard unsaved text, and no acknowledgement claims a save. */
export function capturePendingEditFailureV1(error: unknown): PendingEditFailureTokenV1 | undefined {
  const matches = [...unresolvedFailures].filter(([, failure]) => failure.error === error)
  if (matches.length !== 1) return undefined
  return { key: matches[0][0], writeId: matches[0][1].writeId }
}

export function acknowledgePendingEditFailureV1(input: {
  token: PendingEditFailureTokenV1
  decision: 'retry-command' | 'abandon-command'
}): void {
  const { token, decision } = input
  if (!token || typeof token.key !== 'string' || !token.key.trim() || !Number.isSafeInteger(token.writeId) || token.writeId < 1
    || !['retry-command', 'abandon-command'].includes(decision)) throw new Error('作者操作失败回执无效。')
  if ([...pendingWrites.values()].some(write => write.key === token.key)) throw new Error('该保存仍在执行，不能结束失败回执。')
  const current = unresolvedFailures.get(token.key)
  if (!current) return
  if (current.writeId !== token.writeId) throw new Error('失败回执已变化，不能忽略新的保存错误。')
  unresolvedFailures.delete(token.key)
}

export function pendingEditDiagnosticsV1(): {
  draftCount: number
  writeCount: number
  failedKeys: string[]
} {
  return {
    draftCount: draftFlushers.size,
    writeCount: pendingWrites.size,
    failedKeys: [...unresolvedFailures.keys()].sort(),
  }
}

/** Test-only reset; production flows resolve failures by a later successful write. */
export function resetPendingEditCoordinatorForTestsV1(): void {
  if (import.meta.env.PROD) throw new Error('生产环境不能重置 PendingEditCoordinator')
  draftFlushers.clear()
  pendingWrites.clear()
  writeTails.clear()
  unresolvedFailures.clear()
  nextWriteId = 1
}
