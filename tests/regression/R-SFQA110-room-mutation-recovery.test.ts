import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  AuthoritativeOnlineRoomV1,
  type OnlineRoomCommandV1, type OnlineRoomDomainAdapterV1,
  type OnlineRoomPersistenceV1, type OnlineRoomSnapshotV1,
} from '../../src/lib/online/room-authority'

async function fixture() {
  let snapshot: OnlineRoomSnapshotV1 | null = null
  const faults = { export: '' as '' | 'sync' | 'async' | 'clone', persist: false, restore: false }
  const history: string[] = []
  const persistence: OnlineRoomPersistenceV1 = {
    load: async () => structuredClone(snapshot),
    compareAndSwap: async input => {
      if (faults.persist || (snapshot?.revision ?? null) !== input.expectedRevision) return false
      snapshot = structuredClone(input.snapshot)
      return true
    },
  }
  const adapter: OnlineRoomDomainAdapterV1 = {
    apply: async ({ command }) => {
      history.push(command.requestId)
      return { eventType: 'room.chat.message', publicPayload: {}, resultingStateHash: await hashCanonicalValue(history) }
    },
    project: async () => [...history],
    exportCheckpoint: () => {
      if (faults.export === 'sync') throw new Error('checkpoint sync failed')
      if (faults.export === 'async') return Promise.reject(new Error('checkpoint async failed'))
      if (faults.export === 'clone') return Promise.resolve(() => 'uncloneable')
      return Promise.resolve([...history])
    },
    restoreCheckpoint: vi.fn(async checkpoint => {
      if (faults.restore) throw new Error('domain rollback failed')
      if (!Array.isArray(checkpoint) || checkpoint.some(value => typeof value !== 'string')) throw new Error('invalid fixture checkpoint')
      history.splice(0, history.length, ...checkpoint)
    }),
  }
  const created = await AuthoritativeOnlineRoomV1.create({
    roomId: 'sfqa110.room', releaseHash: 'a'.repeat(64), gmDisplayName: 'GM', adapter, persistence,
  })
  const reconnect = () => created.room.reconnect({ memberId: created.gm.member.memberId, authToken: created.gm.authToken, afterSequence: 0 })
  const command = (requestId: string): OnlineRoomCommandV1 => ({
    protocolVersion: 1, roomId: created.room.roomId, releaseHash: 'a'.repeat(64), requestId,
    memberId: created.gm.member.memberId, authToken: created.gm.authToken,
    expectedSequence: 0, kind: 'chat.message', actorKey: null, payload: { text: 'hello' },
  })
  return { ...created, faults, history, adapter, persistence, reconnect, command }
}

async function settles<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('next public call remained locked')), 500)
    })])
  } finally { clearTimeout(timer) }
}

describe('SFQA110: every acquired mutation lock is released, including backup failures', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(['sync', 'async', 'clone'] as const)('checkpoint %s failure does not run rollback or block the next public call', async kind => {
    const f = await fixture()
    const before = await f.persistence.load(f.room.roomId)
    f.faults.export = kind
    await expect(f.reconnect()).rejects.toThrow()
    expect(f.adapter.restoreCheckpoint).not.toHaveBeenCalled()
    expect(await f.persistence.load(f.room.roomId)).toEqual(before)
    f.faults.export = ''
    expect(await settles(f.reconnect())).toMatchObject({ cursor: 0, events: [], projection: [] })
    expect((await f.persistence.load(f.room.roomId))?.revision).toBe(before!.revision + 1)
  })

  it('captureLocalState failure releases the lock without attempting an unavailable backup', async () => {
    const f = await fixture()
    vi.spyOn(globalThis, 'structuredClone').mockImplementationOnce(() => { throw new Error('local backup failed') })
    await expect(f.reconnect()).rejects.toThrow('local backup failed')
    expect(f.adapter.restoreCheckpoint).not.toHaveBeenCalled()
    expect(await settles(f.reconnect())).toMatchObject({ cursor: 0, projection: [] })
  })

  it('persist conflict rolls back both owners; the same request can succeed once and survives reload', async () => {
    const f = await fixture()
    const before = await f.persistence.load(f.room.roomId)
    f.faults.persist = true
    await expect(f.room.submit(f.command('recover.request'))).rejects.toThrow('持久化版本冲突')
    expect(f.history).toEqual([])
    expect(await f.persistence.load(f.room.roomId)).toEqual(before)
    f.faults.persist = false
    expect(await settles(f.room.submit(f.command('recover.request')))).toMatchObject({ duplicate: false, acceptedSequence: 1 })
    expect(await settles(f.room.submit(f.command('recover.request')))).toMatchObject({ duplicate: true, acceptedSequence: 1 })
    expect(f.history).toEqual(['recover.request'])
    const restored = await AuthoritativeOnlineRoomV1.restore({ roomId: f.room.roomId, persistence: f.persistence, adapter: f.adapter })
    const recovered = await restored.reconnect({ memberId: f.gm.member.memberId, authToken: f.gm.authToken, afterSequence: 0 })
    expect(recovered).toMatchObject({ cursor: 1, projection: ['recover.request'] })
    expect(recovered.events).toHaveLength(1)
  })

  it('reports both the original failure and failed rollback, then restores before accepting another mutation', async () => {
    const f = await fixture()
    const before = await f.persistence.load(f.room.roomId)
    f.faults.persist = true
    f.faults.restore = true
    await expect(f.room.submit(f.command('failed.request'))).rejects.toThrow(/持久化版本冲突.*domain rollback failed/)
    expect(await f.persistence.load(f.room.roomId)).toEqual(before)
    await expect(settles(f.reconnect())).rejects.toThrow('domain rollback failed')
    expect(f.history).toEqual(['failed.request'])
    f.faults.restore = false
    f.faults.persist = false
    expect(await settles(f.reconnect())).toMatchObject({ cursor: 0, events: [], projection: [] })
    expect(f.history).toEqual([])
    expect(await settles(f.room.submit(f.command('next.request')))).toMatchObject({ acceptedSequence: 1 })
    expect(f.history).toEqual(['next.request'])
    expect((await f.persistence.load(f.room.roomId))?.domainCheckpoint).toEqual(['next.request'])
  })
})
