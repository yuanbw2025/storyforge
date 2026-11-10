import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assertRecordInScope, readOwnedRows, resolveWorldOwnerScopeLike, stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

describe('SFQA-003 · registered World owner boundary', () => {
  it('can resolve, stamp and inspect World-owned rows after the active Work is removed', async () => {
    const { scope } = await seedCurrentWorkspace('无作品的世界', { purpose: 'world-engine' })
    await db.projects.update(scope.projectId, { activeWorkId: null })
    await db.works.delete(scope.workId)
    const owner = await resolveWorldOwnerScopeLike(scope.projectId)
    expect(owner).toEqual({ projectId: scope.projectId, worldId: scope.worldId })
    const row = stampNewRecord(owner, 'historicalTimelineEvents', { title: '灯塔' }, { owner: 'world' })
    expect(await assertRecordInScope(owner, 'historicalTimelineEvents', row, { owner: 'world' })).toBe(true)
    expect(await readOwnedRows(owner, 'historicalTimelineEvents', { owner: 'world' })).toEqual([])
    expect(() => Reflect.apply(stampNewRecord, undefined, [owner, 'chapters', {}, { owner: 'work' }])).toThrow()
    await expect(Reflect.apply(readOwnedRows, undefined, [owner, 'chapters', { owner: 'work' }])).rejects.toThrow()
  })

  it('rejects a mismatched Project/World pair and a foreign World row', async () => {
    const a = await seedCurrentWorkspace('甲', { purpose: 'world-engine' })
    const b = await seedCurrentWorkspace('乙', { purpose: 'world-engine' })
    const owner = await resolveWorldOwnerScopeLike(a.scope.projectId)
    await expect(resolveWorldOwnerScopeLike({ projectId: owner.projectId, worldId: b.scope.worldId })).rejects.toThrow()
    const foreign = { projectId: b.scope.projectId, worldId: b.scope.worldId }
    expect(await assertRecordInScope(owner, 'historicalTimelineEvents', foreign, { owner: 'world' })).toBe(false)
    expect(() => stampNewRecord(owner, 'historicalTimelineEvents', { worldId: b.scope.worldId }, { owner: 'world' })).toThrow()
  })
})
