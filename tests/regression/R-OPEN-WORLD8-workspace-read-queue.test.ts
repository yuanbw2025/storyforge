import { describe, expect, it, vi } from 'vitest'
import { createLatestSnapshotReadQueue } from '../../src/components/text-game/latest-snapshot-read'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('Creator workspace snapshot resource bounds', () => {
  it('different panels never hold concurrent lineage reads and later refresh reads fresh evidence', async () => {
    const first = createLatestSnapshotReadQueue()
    const second = createLatestSnapshotReadQueue()
    const entered = deferred()
    const release = deferred()
    let active = 0
    let maximum = 0
    let sourceRevision = 1
    const observed: number[] = []
    const a = first.enqueue(async () => {
      maximum = Math.max(maximum, ++active)
      entered.resolve()
      await release.promise
      observed.push(sourceRevision)
      active--
    })
    await entered.promise
    const b = second.enqueue(async () => {
      maximum = Math.max(maximum, ++active)
      observed.push(sourceRevision)
      active--
    })
    await Promise.resolve()
    expect(active).toBe(1)
    release.resolve()
    await Promise.all([a, b])
    sourceRevision = 2
    await second.enqueue(async () => { observed.push(sourceRevision) })
    expect(maximum).toBe(1)
    expect(observed).toEqual([1, 1, 2])
  })

  it('a panel waiting behind another drops obsolete or unmounted reads', async () => {
    const owner = createLatestSnapshotReadQueue()
    const switched = createLatestSnapshotReadQueue()
    const unmounted = createLatestSnapshotReadQueue()
    const entered = deferred()
    const release = deferred()
    const stale = vi.fn(async () => {})
    const removed = vi.fn(async () => {})
    const latest = vi.fn(async () => {})
    const a = owner.enqueue(async () => { entered.resolve(); await release.promise })
    await entered.promise
    const b = switched.enqueue(stale)
    const c = unmounted.enqueue(removed)
    await Promise.resolve()
    switched.invalidate()
    unmounted.invalidate()
    const d = switched.enqueue(latest)
    release.resolve()
    await Promise.all([a, b, c, d])
    expect(stale).not.toHaveBeenCalled()
    expect(removed).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledOnce()
  })

  it('a rejected reader releases other panels and does not poison a later refresh', async () => {
    const first = createLatestSnapshotReadQueue()
    const second = createLatestSnapshotReadQueue()
    const failure = first.enqueue(async () => { throw new Error('invalid lineage') })
    const later = vi.fn(async () => {})
    const next = second.enqueue(later)
    await expect(failure).rejects.toThrow('invalid lineage')
    await next
    await first.enqueue(later)
    expect(later).toHaveBeenCalledTimes(2)
  })
})
