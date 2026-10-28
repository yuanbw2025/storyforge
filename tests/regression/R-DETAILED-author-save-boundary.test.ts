import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useDetailedOutlineStore } from '../../src/stores/detailed-outline'
import { normalizeDetailedScenes, type DetailedScene } from '../../src/lib/types/detailed-outline'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import * as scopeModule from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import Dexie from 'dexie'

const scene = (sceneId = 'scene-1'): DetailedScene => ({ sceneId, title: '试绳', summary: '', characterIds: [], location: '', conflict: '', pace: 'medium', estimatedWords: 0, notes: '' })
async function fixture() {
  const { scope } = await seedCurrentWorkspace('细纲保存边界')
  const nodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId: scope.projectId, parentId: null, type: 'chapter', title: '第1章', summary: '先测绳，再通行。', order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const detail = await useDetailedOutlineStore.getState().getOrCreate(scope, nodeId)
  await useDetailedOutlineStore.getState().editScene(detail.id!, { kind: 'add', scene: scene() }, scope, '先测绳，再通行。')
  return { scope, nodeId, id: detail.id!, row: (await db.detailedOutlines.get(detail.id!))! }
}
describe('R-DETAILED author save boundary', () => {
  beforeEach(async () => {
    await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
    useDetailedOutlineStore.setState({ detailedOutlines: [], loading: false, loadedScope: null, loadError: null })
  })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('concurrent first additions share one canonical detail row and retain every scene', async () => {
    const { scope } = await seedCurrentWorkspace('并发首建细纲')
    const nodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { projectId: scope.projectId, parentId: null, type: 'chapter', title: '第1章', summary: '', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
    const rows = await Promise.all(Array.from({ length: 6 }, () => useDetailedOutlineStore.getState().getOrCreate(scope, nodeId)))
    expect(new Set(rows.map(row => row.id)).size).toBe(1)
    await Promise.all(rows.map((row, i) => useDetailedOutlineStore.getState().editScene(row.id!, { kind: 'add', scene: scene(`s-${i}`) }, scope, '')))
    const saved = await db.detailedOutlines.where('outlineNodeId').equals(nodeId).toArray()
    expect(saved).toHaveLength(1); expect(saved[0].scenes.map(item => item.sceneId)).toEqual(Array.from({ length: 6 }, (_, i) => `s-${i}`))
  })
  it('does not return a deleted cached row', async () => {
    const f = await fixture(); await db.detailedOutlines.delete(f.id)
    const current = await useDetailedOutlineStore.getState().getOrCreate(f.scope, f.nodeId)
    expect(current.id).not.toBe(f.id); expect(await db.detailedOutlines.get(current.id!)).toBeDefined()
  })
  it('refuses duplicate existing detail rows without selecting one or rewriting data', async () => {
    const f = await fixture(); const { id: _id, ...copy } = f.row
    await db.detailedOutlines.add(copy)
    const before = await db.detailedOutlines.toArray()
    await expect(useDetailedOutlineStore.getState().getOrCreate(f.scope, f.nodeId)).rejects.toThrow(/重复|多个/)
    expect(await db.detailedOutlines.toArray()).toEqual(before)
  })
  it('refuses a volume as the detail parent', async () => {
    const f = await fixture(); await db.outlineNodes.update(f.nodeId, { type: 'volume' })
    await expect(useDetailedOutlineStore.getState().getOrCreate(f.scope, f.nodeId)).rejects.toThrow(/章纲|章节/)
  })
  it('reports deleted rows rather than successful no-op saves', async () => {
    const f = await fixture(); await db.detailedOutlines.delete(f.id)
    await expect(useDetailedOutlineStore.getState().save(f.id, { openingHook: '新开头' }, f.scope)).rejects.toThrow(/删除|不存在/)
  })
  it('rejects owner/identity fields before canonical mutation', async () => {
    const f = await fixture()
    await expect(useDetailedOutlineStore.getState().save(f.id, { workId: 999, outlineNodeId: 999 }, f.scope)).rejects.toThrow(/归属|身份|字段/)
    expect(await db.detailedOutlines.get(f.id)).toEqual(f.row)
  })
  it('reports zero-row updates and preserves the cache', async () => {
    const f = await fixture(); const before = useDetailedOutlineStore.getState().detailedOutlines
    vi.spyOn(db.detailedOutlines, 'update').mockResolvedValueOnce(0)
    await expect(useDetailedOutlineStore.getState().save(f.id, { openingHook: '未保存' }, f.scope)).rejects.toThrow()
    expect(useDetailedOutlineStore.getState().detailedOutlines).toEqual(before)
    expect(await db.detailedOutlines.get(f.id)).toEqual(f.row)
  })
  it('zero-row scene updates are not published as success', async () => {
    const f = await fixture(); vi.spyOn(db.detailedOutlines, 'update').mockResolvedValueOnce(0)
    await expect(useDetailedOutlineStore.getState().editScene(f.id, { kind: 'patch', sceneId: 'scene-1', patch: { title: '未保存' } }, f.scope, '')).rejects.toThrow()
    expect(await db.detailedOutlines.get(f.id)).toEqual(f.row)
  })
  it.each(['add', 'remove'] as const)('a failed %s command does not strand a nonexistent author draft in the navigation barrier', async kind => {
    const f = await fixture(); vi.spyOn(db.detailedOutlines, 'update').mockRejectedValueOnce(new Error('命令写入故障'))
    await expect(useDetailedOutlineStore.getState().editScene(f.id, kind === 'add' ? { kind, scene: scene('new') } : { kind, sceneId: 'scene-1' }, f.scope, '')).rejects.toThrow('命令写入故障')
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
    expect(await db.detailedOutlines.get(f.id)).toEqual(f.row)
  })
  it('freezes caller-owned scene edits before queueing', async () => {
    const f = await fixture(); const patch = { title: '作者确认的文字' }
    const pending = useDetailedOutlineStore.getState().editScene(f.id, { kind: 'patch', sceneId: 'scene-1', patch }, f.scope, '')
    patch.title = '调用后意外变动'
    await pending
    expect((await db.detailedOutlines.get(f.id))!.scenes[0].title).toBe('作者确认的文字')
  })
  it('read failure ends loading and preserves the current view for recovery', async () => {
    const f = await fixture(); await useDetailedOutlineStore.getState().loadAll(f.scope)
    await db.detailedOutlines.update(f.id, { scenes: '损坏原文' as unknown as DetailedScene[] })
    await useDetailedOutlineStore.getState().loadAll(f.scope).catch(() => undefined)
    expect(useDetailedOutlineStore.getState().loading).toBe(false)
    expect(useDetailedOutlineStore.getState().loadError).toMatch(/scenes|场景/)
    expect(useDetailedOutlineStore.getState().detailedOutlines[0].scenes).toEqual(f.row.scenes)
    expect((await db.detailedOutlines.get(f.id))!.scenes).toBe('损坏原文')
  })
  it('optional undefined metadata remains readable and is not filled or rewritten', async () => {
    const f = await fixture(); await db.detailedOutlines.update(f.id, { openingHook: undefined, endingCliffhanger: undefined })
    const before = await db.detailedOutlines.get(f.id)
    await useDetailedOutlineStore.getState().loadAll(f.scope)
    expect(useDetailedOutlineStore.getState().loadError).toBeNull()
    expect(await db.detailedOutlines.get(f.id)).toEqual(before)
  })
  it('scene CAS refuses another page change while unrelated field edits merge from the latest array', async () => {
    const f = await fixture()
    await db.detailedOutlines.update(f.id, { scenes: [{ ...f.row.scenes[0], title: '另一页面的标题' }] })
    await expect(useDetailedOutlineStore.getState().editScene(f.id, { kind: 'patch', sceneId: 'scene-1', patch: { title: '旧页面覆盖' }, expected: { title: '试绳' } }, f.scope, '')).rejects.toThrow('其他页面')
    await useDetailedOutlineStore.getState().editScene(f.id, { kind: 'patch', sceneId: 'scene-1', patch: { notes: '保留新标题' }, expected: { notes: '' } }, f.scope, '')
    expect((await db.detailedOutlines.get(f.id))!.scenes[0]).toMatchObject({ title: '另一页面的标题', notes: '保留新标题' })
  })
  it('whole-field save uses a frozen preimage and refuses a stale scene array', async () => {
    const f = await fixture()
    await db.detailedOutlines.update(f.id, { scenes: [scene(), scene('other-page')] })
    await expect(useDetailedOutlineStore.getState().save(f.id, { scenes: [scene()] }, f.scope)).rejects.toThrow('其他页面')
    expect((await db.detailedOutlines.get(f.id))!.scenes).toHaveLength(2)
  })
  it('a scene cannot reference a character from another World', async () => {
    const f = await fixture(); const other = await seedCurrentWorkspace('其它世界')
    const id = await db.characters.add(stampNewRecord(other.scope, 'characters', { projectId: other.scope.projectId, name: '异乡人', role: 'minor', dimensions: '{}', createdAt: 1, updatedAt: 1 }, { owner: 'world' })) as number
    await expect(useDetailedOutlineStore.getState().editScene(f.id, { kind: 'patch', sceneId: 'scene-1', patch: { characterIds: [id] } }, f.scope, '')).rejects.toThrow('不属于当前世界')
    expect(await db.detailedOutlines.get(f.id)).toEqual(f.row)
  })
  it('a late read cannot replace the current Work or its loading/error state', async () => {
    const f = await fixture(); const other = await seedCurrentWorkspace('另一个作品')
    const original = scopeModule.readOwnedRows
    let release!: () => void, started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const waiting = new Promise<void>(resolve => { started = resolve })
    vi.spyOn(scopeModule, 'readOwnedRows').mockImplementation(async (scope, ...rest) => {
      if (scope.workId === f.scope.workId && scope.projectId === f.scope.projectId) { started(); await gate }
      return original(scope, ...rest)
    })
    const old = useDetailedOutlineStore.getState().loadAll(f.scope)
    await waiting
    await useDetailedOutlineStore.getState().loadAll(other.scope)
    release(); await old
    expect(useDetailedOutlineStore.getState()).toMatchObject({ detailedOutlines: [], loadedScope: other.scope, loading: false, loadError: null })
  })
  it('late write acknowledgement cannot populate a different Work cache', async () => {
    const f = await fixture(); const other = await seedCurrentWorkspace('另一个作品')
    const original = db.detailedOutlines.update.bind(db.detailedOutlines)
    let release!: () => void, started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const waiting = new Promise<void>(resolve => { started = resolve })
    vi.spyOn(db.detailedOutlines, 'update').mockImplementationOnce(async (...args) => {
      started(); await Dexie.waitFor(gate)
      return original(...args)
    })
    const pending = useDetailedOutlineStore.getState().save(f.id, { openingHook: '原作品回执' }, f.scope)
    await waiting
    useDetailedOutlineStore.setState({ loadedScope: other.scope, detailedOutlines: [] })
    release(); await pending
    expect((await db.detailedOutlines.get(f.id))!.openingHook).toBe('原作品回执')
    expect(useDetailedOutlineStore.getState()).toMatchObject({ loadedScope: other.scope, detailedOutlines: [] })
  })
  it.each([
    { title: { text: '损坏标题' } }, { summary: [] }, { characterIds: '1' }, { characterIds: [NaN] },
    { pace: 'invalid' }, { estimatedWords: -1 }, { notes: {} },
  ])('rejects malformed scene fields without repairing them: %j', patch => {
    expect(() => normalizeDetailedScenes([{ ...scene(), ...patch }])).toThrow()
  })
  it('rejects sparse scene arrays and duplicate identities', () => {
    const sparse = Array<DetailedScene>(3); sparse[0] = scene(); sparse[2] = scene('s3')
    expect(() => normalizeDetailedScenes(sparse)).toThrow()
    expect(() => normalizeDetailedScenes([scene(), scene()])).toThrow()
  })
})
