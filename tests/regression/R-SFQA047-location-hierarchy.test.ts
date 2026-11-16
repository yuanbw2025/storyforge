import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { useLocationStore } from '../../src/stores/location'
import { adopt, hashAdoptFieldValueV1, hashAdoptRecordFieldsV1 } from '../../src/lib/registry/adopt'
import type { AdoptInput } from '../../src/lib/registry/types'
import { generateWorldCode } from '../../src/lib/workspace/identity'
import { stampNewRecord } from '../../src/lib/workspace/scope'

async function fixture() {
  const created = await createWorkspace({ name: '合成地点层级', description: '', genres: [], status: 'drafting', targetWordCount: 0 },
    { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const add = (name: string, parentId: number | null = null) => useLocationStore.getState().addLocation({
    projectId: created.scope.projectId, name, parentId, tags: '[]', description: name + '的原文', significance: '', sortOrder: 0,
  })
  const a = await add('海港'), b = await add('码头', a), c = await add('灯塔')
  return { ...created, a, b, c, add }
}

async function snapshot() {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
}

beforeEach(async () => {
  await db.delete(); await db.open()
  useLocationStore.setState({ locations: [], loading: false })
})
afterEach(async () => { await db.delete() })

describe('SFQA047 actual location parent writers', () => {
  it.each(['update-self', 'update-descendant', 'move-self', 'move-descendant'] as const)('%s rejects a cycle with zero database or local view writes', async action => {
    const f = await fixture(), before = await snapshot(), local = structuredClone(useLocationStore.getState().locations)
    const parentId = action.endsWith('self') ? f.a : f.b
    const operation = action.startsWith('update')
      ? useLocationStore.getState().updateLocation(f.a, { parentId })
      : useLocationStore.getState().moveLocation(f.a, parentId)
    await expect(operation).rejects.toThrow(/层级|自身|子地点|父链/)
    expect(await snapshot()).toEqual(before)
    expect(useLocationStore.getState().locations).toEqual(local)
  })

  it.each(['missing', 'foreign', 'same-project-foreign-world'] as const)('rejects an actual %s parent instead of storing it', async kind => {
    const f = await fixture()
    let parentId = 987654
    if (kind === 'foreign') {
      const other = await createWorkspace({ name: '另一个世界', genres: [], description: '', status: 'drafting', targetWordCount: 0 },
        { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
      parentId = await useLocationStore.getState().addLocation({ projectId: other.scope.projectId, name: '外部城池',
        parentId: null, tags: '[]', description: '', significance: '', sortOrder: 0 })
    }
    if (kind === 'same-project-foreign-world') {
      const original = (await db.worlds.get(f.scope.worldId))!
      const worldId = await db.worlds.add({ ...original, id: undefined, code: generateWorldCode(Date.now(), 0.12345), name: '同工作区其他世界' }) as number
      parentId = await db.importantLocations.add(stampNewRecord({ ...f.scope, worldId }, 'importantLocations', {
        projectId: f.scope.projectId, name: '同工作区外世界地点', parentId: null, tags: '[]',
        description: '', significance: '', sortOrder: 0, createdAt: Date.now(), updatedAt: Date.now(),
      }, { owner: 'world' })) as number
    }
    const before = await snapshot()
    await expect(useLocationStore.getState().updateLocation(f.a, { parentId })).rejects.toThrow()
    expect(await snapshot()).toEqual(before)
  })

  it('rejects a missing parent or an already cyclic ancestor chain before inserting a new location', async () => {
    const f = await fixture(), initial = await snapshot()
    await expect(f.add('不能插入的地点', 987654)).rejects.toThrow()
    expect(await snapshot()).toEqual(initial)
    await db.importantLocations.update(f.a, { parentId: f.b })
    const before = await snapshot()
    await expect(f.add('不能接入异常父链的地点', f.b)).rejects.toThrow(/循环|父链/)
    expect(await snapshot()).toEqual(before)
  })

  it('keeps legal moves, ordinary text and ordering, without loading or replacing other nodes', async () => {
    const f = await fixture(), original = await db.importantLocations.get(f.b)
    await useLocationStore.getState().moveLocation(f.b, f.c)
    expect(await db.importantLocations.get(f.b)).toMatchObject({ ...original, parentId: f.c, updatedAt: expect.any(Number) })
    expect(useLocationStore.getState().loading).toBe(false)
    await useLocationStore.getState().updateLocation(f.b, { parentId: null })
    expect((await db.importantLocations.get(f.b))!.parentId).toBeNull()
    expect((await db.importantLocations.toArray()).map(row => row.id)).toEqual([f.a, f.b, f.c])
  })

  it('serializes two individually valid opposite moves without accepting a cycle', async () => {
    const f = await fixture()
    await useLocationStore.getState().moveLocation(f.b, null)
    const results = await Promise.allSettled([
      useLocationStore.getState().moveLocation(f.a, f.b),
      useLocationStore.getState().moveLocation(f.b, f.a),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const a = await db.importantLocations.get(f.a), b = await db.importantLocations.get(f.b)
    expect(a!.parentId === f.b && b!.parentId === f.a).toBe(false)
    expect(useLocationStore.getState().locations.find(row => row.id === f.a)!.parentId).toBe(a!.parentId)
    expect(useLocationStore.getState().locations.find(row => row.id === f.b)!.parentId).toBe(b!.parentId)
  })

  it.each(['record', 'field-set-cas', 'identity-merge'] as const)('rejects a parent cycle through actual adopt %s with no formal writes', async mode => {
    const f = await fixture(), row = (await db.importantLocations.get(f.a))!, before = await snapshot()
    const input: AdoptInput = { projectId: f.scope.projectId, scope: f.scope, target: 'importantLocations',
      mode: 'replace', recordId: f.a, data: { parentId: f.b } }
    if (mode === 'field-set-cas') input.compareAndSet = {
      kind: 'record-fields-value-hash', fields: ['parentId'],
      expectedHash: await hashAdoptRecordFieldsV1(row as unknown as Record<string, unknown>, ['parentId']),
    }
    if (mode === 'identity-merge') {
      delete input.recordId; input.mode = 'add'; input.data = { name: row.name, parentId: f.b }
    }
    const result = await adopt(input)
    expect(result.written).toEqual([])
    expect(result.fkErrors.some(error => error.field === 'parentId')).toBe(true)
    expect(await snapshot()).toEqual(before)
  })

  it('preserves the existing record-only restriction of single-field CAS', async () => {
    const f = await fixture(), before = await snapshot()
    const result = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'importantLocations',
      mode: 'replace', recordId: f.a, data: { parentId: f.b }, compareAndSet: {
        kind: 'record-field-value-hash', field: 'parentId', expectedHash: await hashAdoptFieldValueV1(null),
      } })
    expect(result.written).toEqual([])
    expect(result.skipped.some(item => item.reason.includes('record-only'))).toBe(true)
    expect(await snapshot()).toEqual(before)
  })

  it('retains ordinary guarded adoption and the original stale CAS rejection', async () => {
    const f = await fixture()
    const good = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'importantLocations',
      mode: 'replace', recordId: f.b, data: { parentId: f.c } })
    expect(good.written).toHaveLength(1)
    const before = await snapshot()
    const stale = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'importantLocations',
      mode: 'replace', recordId: f.b, data: { parentId: f.a }, compareAndSet: {
        kind: 'record-fields-value-hash', fields: ['parentId'],
        expectedHash: await hashAdoptRecordFieldsV1({ parentId: f.a }, ['parentId']),
      } })
    expect(stale.written).toEqual([])
    expect(await snapshot()).toEqual(before)
  })

  it('keeps all actual legacy cycle and orphan rows visible without modifying their persisted parent fields', async () => {
    const f = await fixture()
    // Deliberate historical corruption fixture, never a new public write path.
    await db.importantLocations.update(f.a, { parentId: f.b })
    await db.importantLocations.update(f.c, { parentId: 987654 })
    await useLocationStore.getState().loadAll(f.scope)
    const before = await snapshot(), seen = new Set<number>(), stack = [...useLocationStore.getState().getTree()]
    while (stack.length) {
      const row = stack.pop()!
      expect(seen.has(row.id!)).toBe(false)
      seen.add(row.id!); stack.push(...row.children)
    }
    expect([...seen].sort()).toEqual([f.a, f.b, f.c].sort())
    expect(await snapshot()).toEqual(before)
  })

  it('gives a bounded cycle deletion error and permits an explicit parent repair before normal deletion', async () => {
    const f = await fixture()
    await db.importantLocations.update(f.a, { parentId: f.b })
    await useLocationStore.getState().loadAll(f.scope)
    const before = await snapshot()
    const failure = await useLocationStore.getState().deleteLocation(f.a).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(RangeError)
    expect((failure as Error).message).toMatch(/层级|循环/)
    expect(await snapshot()).toEqual(before)
    // Unrelated text edits remain possible; the author chooses the repair.
    await useLocationStore.getState().updateLocation(f.a, { name: '修复前仍可阅读编辑' })
    await useLocationStore.getState().updateLocation(f.a, { parentId: null })
    await useLocationStore.getState().deleteLocation(f.a)
    expect(await db.importantLocations.get(f.a)).toBeUndefined()
    expect(await db.importantLocations.get(f.b)).toBeUndefined()
    expect((await db.importantLocations.get(f.c))!.name).toBe('灯塔')
  })
})
