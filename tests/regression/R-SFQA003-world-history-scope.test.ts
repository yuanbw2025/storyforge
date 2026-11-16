import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import { createHistory, domainScope, listHistory } from '../../src/lib/extensions/domain'
import { activePackages, disablePackage, enablePackage, extensionScope, installPackage, putExtensionRecord, scopeOf } from '../../src/lib/extensions/store'
import type { ExtensionManifest } from '../../src/lib/extensions/types'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { isPortableResourceUidV1 } from '../../src/lib/context-gateway/resource-uid'
import { generateWorldCode } from '../../src/lib/workspace/identity'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import * as scopes from '../../src/lib/workspace/scope'
import type { HistoricalTimelineEvent, World, WorldOwnerScope } from '../../src/lib/types'
import { useHistoricalStore } from '../../src/stores/historical'
import { addCurrentWorkFixtureV1, seedCurrentWorkspace } from '../helpers/current-workspace'

type WorldOwnedEvent = HistoricalTimelineEvent & { worldId: number; workId?: number | null }

const entry = { title: '灯塔建成', description: '作者确认的历史原文', time: '125' }

async function fixture(owner: 'world' | 'work' = 'world') {
  const { scope } = await seedCurrentWorkspace('插件历史', { purpose: 'world-engine', enableMultiWorld: true })
  const manifest: ExtensionManifest = {
    format: 1, api: 1, id: `test.history-${owner}`, version: '1.0.0', name: '历史测试',
    description: '隔离的作者历史操作', author: 'test', license: 'MIT', kind: 'feature', owner,
    entry: 'main.js', dependencies: {}, permissions: ['history.read', 'history.write'],
    networkOrigins: [], views: [], schemas: {}, provides: [], consumes: [],
  }
  const zip = new JSZip().file('manifest.json', JSON.stringify(manifest), { date: new Date('2020-01-01Z') })
    .file('main.js', 'export default () => ({activate(){}})', { date: new Date('2020-01-01Z') })
  const pkg = await installPackage(await zip.generateAsync({ type: 'arraybuffer' }))
  const extensionOwner = await extensionScope(scope.projectId, owner)
  await enablePackage(pkg, extensionOwner)
  const [{ profile }] = await activePackages(extensionOwner)
  return { scope, profile, pkg }
}

async function otherWorld(projectId: number) {
  const world: World = { projectId, identityKind: 'world-draft', code: generateWorldCode(), name: '另一世界', description: '', currentVersion: 0, createdAt: 1, updatedAt: 1 }
  const worldId = await db.worlds.add(world)
  const work = await addCurrentWorkFixtureV1({ projectId, worldId, create: { title: '另一世界的作品', kind: 'novel', novelProfile: 'long' } })
  return { worldId, workId: work.id! }
}

beforeEach(async () => {
  await db.delete(); await db.open()
  useHistoricalStore.setState({ events: [], keywords: [], loading: false, loadingKeywords: false, loadedEventsScope: null })
})
afterEach(() => { vi.restoreAllMocks(); db.close() })

describe('SFQA-003 · World-owned author history', () => {
  it('reads and creates for a valid World profile without any active or existing Work', async () => {
    const f = await fixture()
    await db.projects.update(f.scope.projectId, { activeWorkId: null })
    await db.works.delete(f.scope.workId)
    const before = await db.works.toArray()
    const workRead = vi.spyOn(db.works, 'get')
    expect(await listHistory(f.profile)).toEqual([])
    await useHistoricalStore.getState().loadEvents(f.scope.projectId)
    await createHistory(f.profile, entry)
    expect(await listHistory(f.profile)).toEqual([expect.objectContaining(entry)])
    expect(useHistoricalStore.getState().events.map(row => row.title)).toEqual([entry.title])
    const [row] = await db.historicalTimelineEvents.toArray()
    expect(row).toMatchObject({ projectId: f.scope.projectId, worldId: f.scope.worldId })
    expect((row as WorldOwnedEvent).workId).toBeUndefined()
    expect(workRead).not.toHaveBeenCalled()
    expect(await db.works.toArray()).toEqual(before)
  })

  it('keeps the frozen World after switching and deleting the unrelated active Work', async () => {
    const f = await fixture()
    const b = await createWorldWork(f.scope.projectId, { title: '作品B', kind: 'novel', novelProfile: 'long' })
    await switchActiveWork(f.scope.projectId, b.id!)
    await createHistory(f.profile, entry)
    await db.works.delete(b.id!)
    await createHistory(f.profile, { ...entry, title: '作品删除后仍是同一世界' })
    expect((await listHistory(f.profile)).map(row => row.title)).toEqual(['灯塔建成', '作品删除后仍是同一世界'])
    expect((await db.historicalTimelineEvents.toArray()).every(row => (row as WorldOwnedEvent).worldId === f.scope.worldId)).toBe(true)
    expect(await db.works.count()).toBe(1)
  })

  it('does not follow a newly active World or read its private history', async () => {
    const f = await fixture()
    const b = await otherWorld(f.scope.projectId)
    await switchActiveWork(f.scope.projectId, b.workId)
    const bOwner = await extensionScope(f.scope.projectId, 'world')
    await enablePackage(f.pkg, bOwner)
    const [{ profile: bProfile }] = await activePackages(bOwner)
    await createHistory(bProfile, { ...entry, title: 'B世界秘密' })
    await useHistoricalStore.getState().loadEvents(f.scope.projectId)
    const shownB = useHistoricalStore.getState().events
    await createHistory(f.profile, entry)
    expect((await listHistory(f.profile)).map(row => row.title)).toEqual(['灯塔建成'])
    expect((await listHistory(bProfile)).map(row => row.title)).toEqual(['B世界秘密'])
    expect((await db.projects.get(f.scope.projectId))?.activeWorldId).toBe(b.worldId)
    expect(useHistoricalStore.getState().events).toEqual(shownB)
  })

  it('rejects forged cross-World and cross-project profile owners before any write', async () => {
    const f = await fixture()
    const b = await otherWorld(f.scope.projectId)
    const foreign = await seedCurrentWorkspace('外来世界', { purpose: 'world-engine' })
    const bWorld = (await db.worlds.get(b.worldId))!
    for (const changed of [
      { ...f.profile, worldId: b.worldId, ownerKey: `world:${bWorld.code}` },
      { ...f.profile, projectId: foreign.scope.projectId, worldId: foreign.scope.worldId },
    ]) {
      await expect(listHistory(changed)).rejects.toThrow()
      await expect(createHistory(changed, entry)).rejects.toThrow()
    }
    expect(await db.historicalTimelineEvents.count()).toBe(0)
  })

  it('rejects stale or disabled profiles and a deleted World without reviving them', async () => {
    const f = await fixture()
    await expect(createHistory({ ...f.profile, revision: f.profile.revision - 1 }, entry)).rejects.toThrow()
    await disablePackage(f.profile)
    await expect(createHistory(f.profile, entry)).rejects.toThrow()
    await enablePackage(f.pkg, await extensionScope(f.scope.projectId, 'world'))
    const [{ profile }] = await activePackages(await extensionScope(f.scope.projectId, 'world'))
    await db.worlds.delete(f.scope.worldId)
    await expect(listHistory(profile)).rejects.toThrow()
    await expect(createHistory(profile, entry)).rejects.toThrow()
    expect(await db.historicalTimelineEvents.count()).toBe(0)
  })

  it('rejects Work-owned helpers without a Work even when their table is empty', async () => {
    const f = await fixture()
    const scope: WorldOwnerScope = { projectId: f.scope.projectId, worldId: f.scope.worldId }
    await expect(Reflect.apply(scopes.readOwnedRows, undefined, [scope, 'chapters', { owner: 'work' }])).rejects.toThrow(/真实 Work|World owner|世界操作|作用域|Work/)
    await expect(Reflect.apply(scopes.assertRecordInScope, undefined, [scope, 'stateCards', undefined, { owner: 'work' }])).rejects.toThrow()
    expect(() => Reflect.apply(scopes.stampNewRecord, undefined, [scope, 'chapters', { title: '不能制造作品' }, { owner: 'work' }])).toThrow()
    await expect(Reflect.apply(scopes.readOwnedRows, undefined, [scope, 'historicalTimelineEvents'])).rejects.toThrow()
    expect(await db.chapters.count()).toBe(0)
    expect(await db.works.count()).toBe(1)
  })

  it('validates actual Project/World membership and stable identity without falling back', async () => {
    const f = await fixture()
    const foreign = await seedCurrentWorkspace('外来世界', { purpose: 'world-engine' })
    const owner = await scopes.resolveWorldOwnerScopeLike(f.scope.projectId)
    expect(await scopes.assertRecordInScope(owner, 'historicalTimelineEvents', foreign.scope, { owner: 'world' })).toBe(false)
    expect(() => scopes.stampNewRecord(owner, 'historicalTimelineEvents', { worldId: foreign.scope.worldId }, { owner: 'world' })).toThrow()
    await expect(scopes.resolveWorldOwnerScopeLike({ projectId: f.scope.projectId, worldId: foreign.scope.worldId })).rejects.toThrow()
    await db.projects.update(f.scope.projectId, { activeWorldId: null })
    await expect(scopes.resolveWorldOwnerScopeLike(f.scope.projectId)).rejects.toThrow()
    expect(await scopes.resolveWorldOwnerScopeLike({ projectId: f.scope.projectId, worldId: f.scope.worldId })).toEqual({ projectId: f.scope.projectId, worldId: f.scope.worldId })
    await db.worlds.update(f.scope.worldId, { code: 'legacy-world' })
    await expect(createHistory(f.profile, entry)).rejects.toThrow()
    expect(await db.historicalTimelineEvents.count()).toBe(0)
  })

  it('keeps real native transaction rollback when the original Work is absent', async () => {
    const f = await fixture()
    await db.works.delete(f.scope.workId)
    await expect(db.transaction('rw', scopes.scopeTransactionTables(db.extensionProfiles, db.historicalTimelineEvents, db.storyTimelineEvents), async () => {
      await createHistory(f.profile, entry)
      expect(await db.historicalTimelineEvents.count()).toBe(1)
      throw new Error('作者操作回滚')
    })).rejects.toThrow('作者操作回滚')
    expect(await db.historicalTimelineEvents.count()).toBe(0)
  })

  it('preserves the full Work profile and formal AI scope contracts', async () => {
    const f = await fixture('work')
    const b = await createWorldWork(f.scope.projectId, { title: '作品B', kind: 'novel', novelProfile: 'long' })
    await switchActiveWork(f.scope.projectId, b.id!)
    await createHistory(f.profile, entry)
    expect((await db.storyTimelineEvents.toArray())[0]).toMatchObject({ workId: f.scope.workId })
    expect((await domainScope(f.profile)).workId).toBe(f.scope.workId)
    expect(await listHistory(f.profile)).toEqual([expect.objectContaining(entry)])
    await db.works.delete(f.scope.workId)
    await expect(listHistory(f.profile)).rejects.toThrow()
    await expect(domainScope(f.profile)).rejects.toThrow()
    await expect(scopes.resolveScopeLike(f.scope.projectId)).resolves.toMatchObject({ workId: b.id! })
    expect(await db.historicalTimelineEvents.count()).toBe(0)
  })

  it('retains registered World ownership and portable resource identity through backup import', async () => {
    const f = await fixture()
    await createHistory(f.profile, entry)
    const original = (await db.historicalTimelineEvents.toArray())[0]
    const identity = scopes.getTableSpec('historicalTimelineEvents').resourceIdentity!
    const uid: unknown = Reflect.get(original, identity.field)
    expect(isPortableResourceUidV1(uid, identity.resourceKind)).toBe(true)
    const importedId = await deriveImportProjectJSON(await deriveExportProjectJSON(f.scope.projectId))
    const imported = (await db.historicalTimelineEvents.where('projectId').equals(importedId).toArray())[0]
    const importedWorld = (await db.worlds.where('projectId').equals(importedId).toArray())[0]
    expect(imported).toMatchObject({ title: entry.title, description: entry.description, worldId: importedWorld.id })
    expect((imported as WorldOwnedEvent).workId ?? null).toBeNull()
    expect(Reflect.get(imported, identity.field)).toBe(uid)
    expect(importedWorld.id).not.toBe(f.scope.worldId)
    expect(await scopes.readOwnedRows<HistoricalTimelineEvent>(f.scope, 'historicalTimelineEvents', { owner: 'world' })).toHaveLength(1)
  })
})

async function linkedNote(f: Awaited<ReturnType<typeof fixture>>, eventId: number) {
  const manifest: ExtensionManifest = { ...f.pkg.manifest, id: 'test.history-notes', permissions: ['data'],
    schemas: { note: { version: 1, schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } } } }
  const zip = new JSZip().file('manifest.json', JSON.stringify(manifest)).file('main.js', 'export default () => ({activate(){}})')
  const pkg = await installPackage(await zip.generateAsync({ type: 'arraybuffer' }))
  const owner = scopeOf(f.profile)
  await enablePackage(pkg, owner)
  const current = (await activePackages(owner)).find(row => row.pkg.pluginId === manifest.id)!
  return putExtensionRecord(current.profile, pkg.manifest, { key: 'main', schemaId: 'note', payload: { text: '保留作者插件笔记' }, expectedRevision: null, historyEventId: eventId })
}

describe('SFQA-003 · World-only event lifecycle in the same history store', () => {
  it('edits and deletes the newly loaded World event without a Work, preserving UID and registered reference cleanup', async () => {
    const f = await fixture()
    await createHistory(f.profile, entry)
    const original = (await db.historicalTimelineEvents.toArray())[0]
    const note = await linkedNote(f, original.id!)
    await db.projects.update(f.scope.projectId, { activeWorkId: null })
    await db.works.delete(f.scope.workId)
    await useHistoricalStore.getState().loadEvents(f.scope.projectId)
    const identity = scopes.getTableSpec('historicalTimelineEvents').resourceIdentity!
    const uid: unknown = Reflect.get(original, identity.field)
    let updateError: string | null = null, deleteError: string | null = null
    try { await useHistoricalStore.getState().updateEvent(original.id!, { title: '作者修订的历史' }) }
    catch (cause) { updateError = cause instanceof Error ? cause.message : String(cause) }
    const afterUpdate = await db.historicalTimelineEvents.get(original.id!)
    expect(useHistoricalStore.getState().events.map(row => row.title)).toEqual(['作者修订的历史'])
    try { await useHistoricalStore.getState().deleteEvent(original.id!) }
    catch (cause) { deleteError = cause instanceof Error ? cause.message : String(cause) }
    expect({ updateError, deleteError, title: afterUpdate?.title, exists: !!await db.historicalTimelineEvents.get(original.id!) })
      .toEqual({ updateError: null, deleteError: null, title: '作者修订的历史', exists: false })
    expect(Reflect.get(afterUpdate!, identity.field)).toBe(uid)
    expect(await db.extensionRecords.get(note.id!)).toEqual({ ...note, historyEventId: null })
    expect(useHistoricalStore.getState().events).toEqual([])
    expect(await db.works.where('projectId').equals(f.scope.projectId).count()).toBe(0)
  })

  it('rejects edits to an existing event owner or stable identity and preserves its original row', async () => {
    const f = await fixture()
    const foreign = await seedCurrentWorkspace('外来项目', { purpose: 'world-engine' })
    await createHistory(f.profile, entry)
    const original = (await db.historicalTimelineEvents.toArray())[0]
    const key = scopes.getTableSpec('historicalTimelineEvents').resourceIdentity!.field
    for (const patch of [
      { projectId: foreign.scope.projectId }, { worldId: foreign.scope.worldId },
      { workId: foreign.scope.workId }, { id: original.id! + 1 },
      { [key]: 'forged' }, { [key + '.suffix']: 'forged' }, { createdAt: original.createdAt - 1 },
    ]) {
      await expect(useHistoricalStore.getState().updateEvent(original.id!, { ...patch, title: '不得移动' })).rejects.toThrow(/身份|归属/)
      expect(await db.historicalTimelineEvents.toArray()).toEqual([original])
    }
  })

  it('does not publish an edited history row while its outer transaction can still roll back', async () => {
    const f = await fixture()
    await createHistory(f.profile, entry)
    const store = useHistoricalStore.getState
    await store().loadEvents(f.scope.projectId)
    const [original] = store().events
    await expect(db.transaction('rw', scopes.scopeTransactionTables(db.historicalTimelineEvents), async () => {
      await store().updateEvent(original.id!, { title: '事务内的临时修订' })
      expect((await db.historicalTimelineEvents.get(original.id!))?.title).toBe('事务内的临时修订')
      expect(store().events).toEqual([original])
      throw new Error('取消历史修订')
    })).rejects.toThrow('取消历史修订')
    expect(await db.historicalTimelineEvents.toArray()).toEqual([original])
    expect(store().events).toEqual([original])
  })

  it('does not let an arbitrary inactive-World event ID bypass the original active-World guard', async () => {
    const f = await fixture()
    await createHistory(f.profile, entry)
    const a = (await db.historicalTimelineEvents.toArray())[0]
    const b = await otherWorld(f.scope.projectId)
    await switchActiveWork(f.scope.projectId, b.workId)
    const bOwner = await extensionScope(f.scope.projectId, 'world')
    await enablePackage(f.pkg, bOwner)
    const [{ profile }] = await activePackages(bOwner)
    await createHistory(profile, { ...entry, title: 'B世界原文' })
    await useHistoricalStore.getState().loadEvents(f.scope.projectId)
    await db.projects.update(f.scope.projectId, { activeWorkId: null })
    await db.works.delete(b.workId)
    const before = await db.historicalTimelineEvents.toArray()
    await useHistoricalStore.getState().updateEvent(a.id!, { title: '不得跨世界更改' })
    await useHistoricalStore.getState().deleteEvent(a.id!)
    expect(await db.historicalTimelineEvents.toArray()).toEqual(before)
    expect(useHistoricalStore.getState().events.map(row => row.title)).toEqual(['B世界原文'])
  })

  it('rolls back the event deletion and registered linked note if cascade persistence fails', async () => {
    const f = await fixture()
    await createHistory(f.profile, entry)
    const event = (await db.historicalTimelineEvents.toArray())[0]
    const note = await linkedNote(f, event.id!)
    await db.projects.update(f.scope.projectId, { activeWorkId: null })
    await db.works.delete(f.scope.workId)
    const failure = new Error('受控引用写入失败')
    const failed = vi.spyOn(db.extensionRecords, 'update').mockRejectedValueOnce(failure)
    await expect(useHistoricalStore.getState().deleteEvent(event.id!)).rejects.toBe(failure)
    expect(failed).toHaveBeenCalledTimes(1)
    expect(await db.historicalTimelineEvents.get(event.id!)).toEqual(event)
    expect(await db.extensionRecords.get(note.id!)).toEqual(note)
  })
})

function holdLoad() {
  let release!: () => void
  const promise = new Promise<void>(done => { release = done })
  return { promise, release }
}

describe('SFQA-003 · the cache publishes only committed author changes', () => {
  it('keeps the original view when the actual outer transaction rolls back a nested public createHistory call', async () => {
    const f = await fixture()
    await createHistory(f.profile, entry)
    await useHistoricalStore.getState().loadEvents(f.scope.projectId)
    const before = useHistoricalStore.getState().events
    const beforeEntries = await listHistory(f.profile)
    let inside: HistoricalTimelineEvent[] = []
    const failure = new Error('最外层作者操作回滚')
    await expect(db.transaction('rw', scopes.scopeTransactionTables(db.extensionProfiles, db.historicalTimelineEvents, db.storyTimelineEvents), async () => {
      await createHistory(f.profile, { ...entry, title: '不应发布到缓存的事务内历史' })
      inside = useHistoricalStore.getState().events
      throw failure
    })).rejects.toBe(failure)
    expect(await listHistory(f.profile)).toEqual(beforeEntries)
    expect(inside).toEqual(before)
    expect(useHistoricalStore.getState().events).toBe(before)
  })

  it('waits for the native root commit and reads its final rows instead of publishing an inner snapshot', async () => {
    const f = await fixture()
    await useHistoricalStore.getState().loadEvents(f.scope.projectId)
    let committed = false, publishedEarly = false
    const unsubscribe = useHistoricalStore.subscribe(state => {
      if (state.events.some(row => row.title === '最外层正式历史') && !committed) publishedEarly = true
    })
    try {
      await db.transaction('rw', scopes.scopeTransactionTables(db.extensionProfiles, db.historicalTimelineEvents, db.storyTimelineEvents), async () => {
        const root = Dexie.currentTransaction!
        root.on('complete', () => { committed = true })
        await createHistory(f.profile, { ...entry, title: '最外层正式历史' })
        const created = (await listHistory(f.profile)).find(row => row.title === '最外层正式历史')!
        await db.historicalTimelineEvents.update(created.id, { description: '最外层提交的最终原文' })
      })
      await vi.waitFor(() => expect(useHistoricalStore.getState().events).toEqual([
        expect.objectContaining({ title: '最外层正式历史', description: '最外层提交的最终原文' }),
      ]))
      expect(committed).toBe(true)
      expect(publishedEarly).toBe(false)
    } finally { unsubscribe() }
  })

  it('does not revive A after a B view is requested while the A root transaction is committing', async () => {
    const a = await fixture(), b = await fixture()
    await createHistory(b.profile, { ...entry, title: 'B提交期间的视图' })
    await useHistoricalStore.getState().loadEvents(a.scope.projectId)
    let bLoad: Promise<void> | undefined
    await db.transaction('rw', scopes.scopeTransactionTables(db.extensionProfiles, db.historicalTimelineEvents, db.storyTimelineEvents), async () => {
      await createHistory(a.profile, entry)
      bLoad = Dexie.ignoreTransaction(() => useHistoricalStore.getState().loadEvents(b.scope.projectId))
    })
    await bLoad
    expect(useHistoricalStore.getState().events.map(row => row.title)).toEqual(['B提交期间的视图'])
    expect(useHistoricalStore.getState().loadedEventsScope).toEqual({ projectId: b.scope.projectId, worldId: b.scope.worldId })
    expect((await listHistory(a.profile)).map(row => row.title)).toEqual([entry.title])
  })
})

describe('SFQA-003 · the history cache belongs to its selected view', () => {
  it('keeps Project B visible while a frozen Project A author creates, edits and deletes its own events', async () => {
    const a = await fixture(), b = await fixture()
    await createHistory(a.profile, entry)
    await createHistory(b.profile, { ...entry, title: 'Project B 的历史' })
    await useHistoricalStore.getState().loadEvents(b.scope.projectId)
    const shownB = useHistoricalStore.getState().events
    await createHistory(a.profile, { ...entry, title: 'A新增的历史' })
    const aEvent = (await listHistory(a.profile))[0]
    await useHistoricalStore.getState().updateEvent(aEvent.id, { title: 'A明确修订' })
    await useHistoricalStore.getState().deleteEvent(aEvent.id)
    expect(useHistoricalStore.getState().events).toEqual(shownB)
    expect((await db.projects.get(a.scope.projectId))?.activeWorldId).toBe(a.scope.worldId)
    expect((await listHistory(a.profile)).map(row => row.title)).toEqual(['A新增的历史'])
    expect((await listHistory(b.profile)).map(row => row.title)).toEqual(['Project B 的历史'])
  })

  it('ignores a late real A owner resolution after the newer B view has loaded', async () => {
    const a = await fixture(), b = await fixture(), gate = holdLoad()
    await createHistory(a.profile, entry)
    await createHistory(b.profile, { ...entry, title: 'B较新的视图' })
    const original = scopes.resolveWorldOwnerScopeLike
    let arrived = false
    vi.spyOn(scopes, 'resolveWorldOwnerScopeLike').mockImplementationOnce(async value => {
      const owner = await original(value); arrived = true; await gate.promise; return owner
    })
    const old = useHistoricalStore.getState().loadEvents(a.scope.projectId)
    try {
      await vi.waitFor(() => expect(arrived).toBe(true))
      await useHistoricalStore.getState().loadEvents(b.scope.projectId)
      const shownB = useHistoricalStore.getState().events
      gate.release(); await old
      expect(useHistoricalStore.getState().events).toEqual(shownB)
      expect(useHistoricalStore.getState().events.map(row => row.title)).toEqual(['B较新的视图'])
      expect(useHistoricalStore.getState().loading).toBe(false)
    } finally { gate.release(); await old }
  })

  it('does not let a late A error stop the B loading indicator or replace its eventual result', async () => {
    const a = await fixture(), b = await fixture(), oldGate = holdLoad(), newGate = holdLoad()
    await createHistory(b.profile, { ...entry, title: 'B加载完成的原文' })
    const original = scopes.resolveWorldOwnerScopeLike
    let aReady = false, bReady = false
    vi.spyOn(scopes, 'resolveWorldOwnerScopeLike')
      .mockImplementationOnce(async value => { await original(value); aReady = true; await oldGate.promise; throw new Error('A受控读取失败') })
      .mockImplementationOnce(async value => { const owner = await original(value); bReady = true; await newGate.promise; return owner })
    const old = useHistoricalStore.getState().loadEvents(a.scope.projectId)
    let current: Promise<void> | undefined
    try {
      await vi.waitFor(() => expect(aReady).toBe(true))
      current = useHistoricalStore.getState().loadEvents(b.scope.projectId)
      await vi.waitFor(() => expect(bReady).toBe(true))
      oldGate.release(); await old
      expect(useHistoricalStore.getState().loading).toBe(true)
      newGate.release(); await current
      expect(useHistoricalStore.getState().events.map(row => row.title)).toEqual(['B加载完成的原文'])
      expect(useHistoricalStore.getState().loading).toBe(false)
    } finally { oldGate.release(); newGate.release(); await old; await current }
  })

  it('clears the previous Project view when the newly requested Project cannot be read', async () => {
    const a = await fixture(), b = await fixture()
    await createHistory(a.profile, entry)
    await useHistoricalStore.getState().loadEvents(a.scope.projectId)
    expect(useHistoricalStore.getState().events).toHaveLength(1)
    vi.spyOn(scopes, 'resolveWorldOwnerScopeLike').mockRejectedValueOnce(new Error('B受控读取失败'))
    await useHistoricalStore.getState().loadEvents(b.scope.projectId)
    expect(useHistoricalStore.getState().events).toEqual([])
    expect(useHistoricalStore.getState().loading).toBe(false)
    expect(useHistoricalStore.getState().loadedEventsScope).toBeNull()
  })
})
