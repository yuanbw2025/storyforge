import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie, { type Transaction } from 'dexie'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import type { WorkspaceScope } from '../../src/lib/types'
import { useCodexStore } from '../../src/stores/codex'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { addCurrentWorldFixtureV1, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import CodexPanel from '../../src/components/codex/CodexPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { useWorldGroupStore } from '../../src/stores/world-group'

type NewEntry = Parameters<ReturnType<typeof useCodexStore.getState>['addEntry']>[0]

function category(scope: WorkspaceScope, name: string, parentId: number | null = null) {
  return useCodexStore.getState().addCategory({
    projectId: scope.projectId, domain: 'humanity', parentId, name,
    icon: '📁', fieldSchema: '[]', hidden: false, order: 0,
  })
}

function entry(scope: WorkspaceScope, categoryId: number, name: string): NewEntry {
  return {
    projectId: scope.projectId, categoryId, name, summary: `完整简介：${name}`,
    description: `完整作者词条：${name}。\r\n保留全部标点与组合字符。🌙e\u0301`,
    fields: '{}', refs: '{}', tags: '["049"]', order: 0, worldGroupId: null,
  }
}

async function fixture(worldEngine = false) {
  const created = await createWorkspace({
    name: '049 合成词条作品', description: '', genres: [], status: 'drafting', targetWordCount: 1000,
  }, { kind: 'novel', novelProfile: 'long', purpose: worldEngine ? 'world-engine' : 'independent-work' })
  await useCodexStore.getState().loadExisting(created.scope)
  const parent = await category(created.scope, '作者选择删除的分类')
  const keep = await category(created.scope, '应完整保留的分类')
  const known = await useCodexStore.getState().addEntry(entry(created.scope, parent, '已有词条'))
  const keptEntry = await useCodexStore.getState().addEntry(entry(created.scope, keep, '应完整保留的词条'))
  return { ...created, parent, keep, known, keptEntry }
}

async function rawDatabase() {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await db.delete()
  await db.open()
  resetPendingEditCoordinatorForTestsV1()
  useCodexStore.setState({ categories: [], entries: [], loadedScope: null, loadedProjectId: null, loading: false, loadError: null })
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('No real network authorized') }))
})

afterEach(async () => {
  try { expect(fetch).not.toHaveBeenCalled() }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetPendingEditCoordinatorForTestsV1(); await db.delete() }
})

describe('SFQA049 · native Codex category deletion and parent ownership', () => {
  it.each(['entry', 'category'] as const)('deletes a legitimate uncached %s from the current native subtree', async childKind => {
    const f = await fixture()
    const categoryBefore = await db.codexCategories.get(f.keep)
    const entryBefore = await db.codexEntries.get(f.keptEntry)
    const proposed = entry(f.scope, f.parent, '已正式采纳但缓存未刷新的词条')
    const inserted = await adopt({
      projectId: f.scope.projectId, scope: f.scope, target: childKind === 'entry' ? 'codexEntries' : 'codexCategories',
      mode: 'add', data: childKind === 'entry' ? {
        categoryId: proposed.categoryId, name: proposed.name, summary: proposed.summary,
        description: proposed.description, fields: proposed.fields, refs: proposed.refs,
      } : {
        domain: 'humanity', parentId: f.parent, name: '已正式采纳但缓存未刷新的子分类', fieldSchema: '[]', order: 1,
      },
    })
    expect(inserted.fkErrors).toEqual([])
    expect(inserted.written).toHaveLength(1)
    const late = inserted.written[0]
    if (!late) throw new Error('公开采纳必须创建真实子项')
    expect((childKind === 'entry' ? useCodexStore.getState().entries : useCodexStore.getState().categories)
      .some(row => row.id === late.id)).toBe(false)
    await useCodexStore.getState().deleteCategory(f.parent)
    expect(await db.codexCategories.get(f.parent)).toBeUndefined()
    expect(await db.codexEntries.get(f.known)).toBeUndefined()
    expect(await db.codexCategories.get(f.keep)).toEqual(categoryBefore)
    expect(await db.codexEntries.get(f.keptEntry)).toEqual(entryBefore)
    expect(await (childKind === 'entry' ? db.codexEntries.get(late.id) : db.codexCategories.get(late.id))).toBeUndefined()
  })

  it('keeps normal cached subtree deletion and unrelated full entries intact', async () => {
    const f = await fixture()
    const child = await category(f.scope, '已加载的子分类', f.parent)
    const childEntry = await useCodexStore.getState().addEntry(entry(f.scope, child, '已加载的下层词条'))
    const keepBefore = await db.codexCategories.get(f.keep)
    const entryBefore = await db.codexEntries.get(f.keptEntry)
    await useCodexStore.getState().deleteCategory(f.parent)
    expect(await db.codexCategories.get(f.parent)).toBeUndefined()
    expect(await db.codexCategories.get(child)).toBeUndefined()
    expect(await db.codexEntries.get(f.known)).toBeUndefined()
    expect(await db.codexEntries.get(childEntry)).toBeUndefined()
    expect(await db.codexCategories.get(f.keep)).toEqual(keepBefore)
    expect(await db.codexEntries.get(f.keptEntry)).toEqual(entryBefore)
  })

  it.each(['category', 'entry'] as const)('checks a new %s parent in its actual native write transaction', async kind => {
    const f = await fixture()
    const parentReads = new Set<Transaction>()
    let writeTransaction: Transaction | undefined
    const nativeGet = db.codexCategories.get.bind(db.codexCategories)
    vi.spyOn(db.codexCategories, 'get').mockImplementation(key => {
      if (typeof key === 'number' && key === f.parent && Dexie.currentTransaction) {
        parentReads.add(Dexie.currentTransaction)
      }
      return nativeGet(key)
    })
    const table = kind === 'category' ? db.codexCategories : db.codexEntries
    const observeWrite = (_key: unknown, _row: unknown, transaction: Transaction) => { writeTransaction = transaction }
    table.hook('creating', observeWrite)
    try {
      if (kind === 'category') await category(f.scope, '同事务子分类', f.parent)
      else await useCodexStore.getState().addEntry(entry(f.scope, f.parent, '同事务词条'))
    } finally { table.hook('creating').unsubscribe(observeWrite) }
    expect(writeTransaction?.mode).toBe('readwrite')
    expect(writeTransaction?.storeNames).toContain('codexCategories')
    expect(writeTransaction && parentReads.has(writeTransaction)).toBe(true)
  })

  it.each(['category', 'entry'] as const)('rejects a late new %s after its parent was deleted with all native rows unchanged', async kind => {
    const f = await fixture()
    await useCodexStore.getState().deleteCategory(f.parent)
    const before = await rawDatabase()
    const result = kind === 'category'
      ? category(f.scope, '不得成为孤儿的分类', f.parent)
      : useCodexStore.getState().addEntry(entry(f.scope, f.parent, '不得成为孤儿的词条'))
    await expect(result).rejects.toThrow()
    expect(await rawDatabase()).toEqual(before)
  })

  it.each(['category', 'entry'] as const)('rejects a %s move to a deleted parent and preserves the surviving source', async kind => {
    const f = await fixture()
    await useCodexStore.getState().deleteCategory(f.parent)
    const before = await rawDatabase()
    const result = kind === 'category'
      ? useCodexStore.getState().updateCategory(f.keep, { parentId: f.parent })
      : useCodexStore.getState().updateEntry(f.keptEntry, { categoryId: f.parent })
    await expect(result).rejects.toThrow()
    expect(await rawDatabase()).toEqual(before)
  })

  it.each(['category', 'entry'] as const)('checks a moved %s parent in its actual native update transaction', async kind => {
    const f = await fixture()
    const reads = new Set<Transaction>()
    let write: Transaction | undefined
    const nativeGet = db.codexCategories.get.bind(db.codexCategories)
    vi.spyOn(db.codexCategories, 'get').mockImplementation(key => {
      if (typeof key === 'number' && key === f.parent && Dexie.currentTransaction) reads.add(Dexie.currentTransaction)
      return nativeGet(key)
    })
    const table = kind === 'category' ? db.codexCategories : db.codexEntries
    const observe = (_changes: unknown, _key: unknown, _row: unknown, transaction: Transaction) => { write = transaction }
    table.hook('updating', observe)
    try {
      if (kind === 'category') await useCodexStore.getState().updateCategory(f.keep, { parentId: f.parent })
      else await useCodexStore.getState().updateEntry(f.keptEntry, { categoryId: f.parent })
    } finally { table.hook('updating').unsubscribe(observe) }
    expect(write?.mode).toBe('readwrite')
    expect(write && reads.has(write)).toBe(true)
  })

  it('preserves a child and entry moved out through public adoption while the original view stays stale', async () => {
    const f = await fixture()
    const child = await category(f.scope, '另页移出的分类', f.parent)
    const movedEntry = await useCodexStore.getState().addEntry(entry(f.scope, f.parent, '另页移出的词条'))
    for (const [target, recordId, data] of [
      ['codexCategories', child, { parentId: f.keep }],
      ['codexEntries', movedEntry, { categoryId: f.keep }],
    ] as const) {
      const result = await adopt({ projectId: f.scope.projectId, scope: f.scope, target, recordId, mode: 'replace', data })
      expect(result.fkErrors).toEqual([])
      expect(result.written).toHaveLength(1)
    }
    const childBefore = await db.codexCategories.get(child), entryBefore = await db.codexEntries.get(movedEntry)
    expect(useCodexStore.getState().categories.find(row => row.id === child)?.parentId).toBe(f.parent)
    await useCodexStore.getState().deleteCategory(f.parent)
    expect(await db.codexCategories.get(child)).toEqual(childBefore)
    expect(await db.codexEntries.get(movedEntry)).toEqual(entryBefore)
    expect(useCodexStore.getState().categories.find(row => row.id === child)).toEqual(childBefore)
    expect(useCodexStore.getState().entries.find(row => row.id === movedEntry)).toEqual(entryBefore)
  })

  it('clears existing JSON and registered character references without rewriting author text or frozen World releases', async () => {
    const f = await fixture(true)
    await useCodexStore.getState().updateEntry(f.keptEntry, { refs: JSON.stringify({ allies: [f.known, f.keptEntry, f.known] }) })
    const character = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'characters', mode: 'add',
      data: { name: '完整保留的角色', roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful', raceEntryId: f.known,
        background: '角色原文不因分类删除改变。' } })
    expect(character.written, JSON.stringify(character)).toHaveLength(1)
    const characterId = character.written[0].id
    const before = (await db.codexEntries.get(f.keptEntry))!, characterBefore = (await db.characters.get(characterId))!
    const revision = await createWorldRevision({ scope: f.scope, label: '词条删除前封存' })
    const release = await publishWorldRevision(revision.id!)
    await useCodexStore.getState().deleteCategory(f.parent)
    expect(await db.codexEntries.get(f.keptEntry)).toEqual({ ...before, refs: JSON.stringify({ allies: [f.keptEntry] }), updatedAt: expect.any(Number) })
    expect(await db.characters.get(characterId)).toEqual({ ...characterBefore, raceEntryId: null, updatedAt: expect.any(Number) })
    expect(await db.worldRevisions.get(revision.id!)).toEqual(revision)
    expect(await db.worldReleases.get(release.id!)).toEqual(release)
  })

  it('keeps a built-in category immutable under deletion, including its entries', async () => {
    const f = await fixture()
    await useCodexStore.getState().ensureBuiltIns(f.scope)
    await useCodexStore.getState().loadExisting(f.scope)
    const builtIn = useCodexStore.getState().categories.find(row => row.builtInKey === 'race')!
    await useCodexStore.getState().addEntry(entry(f.scope, builtIn.id!, '内置分类的作者词条'))
    const before = await rawDatabase()
    await useCodexStore.getState().deleteCategory(builtIn.id!)
    expect(await rawDatabase()).toEqual(before)
  })

  it('deletes the selected category across its World groups and keeps the groups themselves', async () => {
    const f = await fixture()
    const group = await useWorldGroupStore.getState().createGroup({ projectId: f.scope.projectId,
      name: '同World的平行世界组', description: '完整组描述', type: 'parallel', icon: '🌐', order: 0 }, f.scope)
    const grouped = await useCodexStore.getState().addEntry({ ...entry(f.scope, f.parent, '组内词条'), worldGroupId: group })
    const before = await db.worldGroups.get(group)
    await useCodexStore.getState().deleteCategory(f.parent)
    expect(await db.codexEntries.get(grouped)).toBeUndefined()
    expect(await db.worldGroups.get(group)).toEqual(before)
  })

  it('handles an uncached 160-level real tree with bounded iteration', async () => {
    const f = await fixture()
    let parent = f.parent
    for (let depth = 0; depth < 160; depth++) {
      parent = await db.codexCategories.add(stampNewRecord(f.scope, 'codexCategories', {
        projectId: f.scope.projectId, domain: 'humanity' as const, parentId: parent,
        name: `真实旧树第${depth}层`, fieldSchema: '[]', order: depth, createdAt: depth, updatedAt: depth,
      }, { owner: 'world' })) as number
    }
    const leaf = await useCodexStore.getState().addEntry(entry(f.scope, parent, '最深层完整词条'))
    await useCodexStore.getState().deleteCategory(f.parent)
    expect(await db.codexCategories.count()).toBe(1)
    expect(await db.codexCategories.get(f.keep)).toBeDefined()
    expect(await db.codexEntries.get(leaf)).toBeUndefined()
  })

  it.each(['cycle', 'orphan', 'built-in-child'] as const)('refuses a damaged %s tree without any partial deletion or cache change', async damage => {
    const f = await fixture()
    const child = await category(f.scope, '保留损坏边供显式修复', f.parent)
    if (damage === 'cycle') await db.codexCategories.update(f.parent, { parentId: child })
    else if (damage === 'orphan') await db.codexCategories.update(f.parent, { parentId: 999999 })
    else await db.codexCategories.update(child, { builtInKey: 'race' })
    const before = await rawDatabase(), cached = structuredClone({ categories: useCodexStore.getState().categories, entries: useCodexStore.getState().entries })
    await expect(useCodexStore.getState().deleteCategory(f.parent)).rejects.toThrow()
    expect(await rawDatabase()).toEqual(before)
    expect({ categories: useCodexStore.getState().categories, entries: useCodexStore.getState().entries }).toEqual(cached)
  })

  it.each(['category', 'entry'] as const)('refuses a linked foreign-owner %s instead of deleting outside the selected World', async kind => {
    const f = await fixture()
    const foreign = await addCurrentWorldFixtureV1({ projectId: f.scope.projectId, name: '同工作区的另一个世界' })
    const work = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: foreign.id!, create: { title: '另世界作品' } })
    const scope = { projectId: f.scope.projectId, worldId: foreign.id!, workId: work.id! }
    if (kind === 'category') {
      await db.codexCategories.add(stampNewRecord(scope, 'codexCategories', {
        projectId: scope.projectId, parentId: f.parent, name: '故意损坏的外世界子分类', domain: 'humanity' as const,
        fieldSchema: '[]', order: 0, createdAt: 1, updatedAt: 1,
      }, { owner: 'world' }))
    } else {
      await db.codexEntries.add(stampNewRecord(scope, 'codexEntries', {
        ...entry(scope, f.parent, '故意损坏的外世界词条'), origin: 'manual' as const,
        sourceEvidenceQuotes: '[]', sourceContentHash: '', producerRunId: null, producerCandidateHash: null, createdAt: 1, updatedAt: 1,
      }, { owner: 'world' }))
    }
    const before = await rawDatabase()
    await expect(useCodexStore.getState().deleteCategory(f.parent)).rejects.toThrow('其他世界')
    expect(await rawDatabase()).toEqual(before)
  })

  it('preserves unlinked other World, other Work, and other workspace rows byte for byte', async () => {
    const f = await fixture()
    const siblingWork = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: f.scope.worldId, create: { title: '同世界作品' } })
    const foreign = await addCurrentWorldFixtureV1({ projectId: f.scope.projectId, name: '另世界' })
    const foreignWork = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: foreign.id!, create: { title: '另世界作品' } })
    const otherScope = { projectId: f.scope.projectId, worldId: foreign.id!, workId: foreignWork.id! }
    const result = await adopt({ projectId: f.scope.projectId, scope: otherScope, target: 'codexCategories', mode: 'add',
      data: { domain: 'humanity', name: '另世界完整分类', parentId: null, fieldSchema: '[]', order: 0 } })
    expect(result.written).toHaveLength(1)
    const foreignCategory = result.written[0].id
    const other = await fixture()
    await useCodexStore.getState().loadExisting(f.scope)
    const before = { siblingWork: await db.works.get(siblingWork.id!), foreignWorld: await db.worlds.get(foreign.id!),
      foreignWork: await db.works.get(foreignWork.id!), foreignCategory: await db.codexCategories.get(foreignCategory),
      otherCategory: await db.codexCategories.get(other.parent), otherEntry: await db.codexEntries.get(other.known) }
    await useCodexStore.getState().deleteCategory(f.parent)
    expect({ siblingWork: await db.works.get(siblingWork.id!), foreignWorld: await db.worlds.get(foreign.id!),
      foreignWork: await db.works.get(foreignWork.id!), foreignCategory: await db.codexCategories.get(foreignCategory),
      otherCategory: await db.codexCategories.get(other.parent), otherEntry: await db.codexEntries.get(other.known) }).toEqual(before)
  })

  it('rechecks a cached selected category against its actual changed owner before deleting any rows', async () => {
    const f = await fixture()
    const foreign = await addCurrentWorldFixtureV1({ projectId: f.scope.projectId, name: '旧页面之外的新归属世界' })
    // Isolated damage represents a changed persisted owner under a legitimate
    // old view; it must not turn that cache into authority over the new owner.
    await db.table<Record<string, unknown>, number>('codexCategories').update(f.parent, { worldId: foreign.id! })
    const before = await rawDatabase()
    await expect(useCodexStore.getState().deleteCategory(f.parent)).rejects.toThrow('当前世界')
    expect(await rawDatabase()).toEqual(before)
  })

  it('rolls back native children, entries, reference cleanup and the cache if actual root deletion fails', async () => {
    const f = await fixture()
    await category(f.scope, '删除父级前已处理的子分类', f.parent)
    await useCodexStore.getState().updateEntry(f.keptEntry, { refs: JSON.stringify({ related: [f.known] }) })
    const before = await rawDatabase(), cached = structuredClone({ categories: useCodexStore.getState().categories, entries: useCodexStore.getState().entries })
    const fail = (key: unknown) => { if (key === f.parent) throw new Error('synthetic native root deletion failure') }
    db.codexCategories.hook('deleting', fail)
    try { await expect(useCodexStore.getState().deleteCategory(f.parent)).rejects.toThrow('synthetic native root deletion failure') }
    finally { db.codexCategories.hook('deleting').unsubscribe(fail) }
    expect(await rawDatabase()).toEqual(before)
    expect({ categories: useCodexStore.getState().categories, entries: useCodexStore.getState().entries }).toEqual(cached)
  })

  it.each(['add-category', 'add-entry', 'move-category', 'move-entry'] as const)('captures %s scalar input before the first await', async action => {
    const f = await fixture()
    if (action === 'add-category') {
      const input = { projectId: f.scope.projectId, domain: 'humanity' as const, parentId: f.parent, name: '调用时分类', fieldSchema: '[]', order: 0 }
      const pending = useCodexStore.getState().addCategory(input)
      input.parentId = f.keep; input.name = '晚改分类'
      const id = await pending
      expect((await db.codexCategories.get(id))?.parentId).toBe(f.parent)
      expect((await db.codexCategories.get(id))?.name).toBe('调用时分类')
    } else if (action === 'add-entry') {
      const input = entry(f.scope, f.parent, '调用时词条')
      const pending = useCodexStore.getState().addEntry(input)
      input.categoryId = f.keep; input.description = '晚改原文'
      const id = await pending
      expect((await db.codexEntries.get(id))?.categoryId).toBe(f.parent)
      expect((await db.codexEntries.get(id))?.description).toBe(entry(f.scope, f.parent, '调用时词条').description)
    } else if (action === 'move-category') {
      const patch = { parentId: f.parent, name: '调用时移动分类' }
      const pending = useCodexStore.getState().updateCategory(f.keep, patch)
      patch.parentId = 999999; patch.name = '晚改移动分类'
      await pending
      expect((await db.codexCategories.get(f.keep))?.parentId).toBe(f.parent)
      expect((await db.codexCategories.get(f.keep))?.name).toBe('调用时移动分类')
    } else {
      const patch = { categoryId: f.parent, description: '调用时移动词条完整原文。' }
      const pending = useCodexStore.getState().updateEntry(f.keptEntry, patch)
      patch.categoryId = 999999; patch.description = '晚改移动词条'
      await pending
      expect((await db.codexEntries.get(f.keptEntry))?.categoryId).toBe(f.parent)
      expect((await db.codexEntries.get(f.keptEntry))?.description).toBe('调用时移动词条完整原文。')
    }
  })

  it.each(['category', 'entry'] as const)('serializes a real concurrent %s insertion with parent deletion without producing an orphan', async kind => {
    const f = await fixture()
    const create = () => kind === 'category' ? category(f.scope, '并发子分类', f.parent)
      : useCodexStore.getState().addEntry(entry(f.scope, f.parent, '并发词条'))
    const added = create()
    const removed = useCodexStore.getState().deleteCategory(f.parent)
    const [result, deletion] = await Promise.allSettled([added, removed])
    expect(deletion.status).toBe('fulfilled')
    expect(await db.codexCategories.get(f.parent)).toBeUndefined()
    if (result.status === 'fulfilled') expect(await (kind === 'category' ? db.codexCategories.get(result.value) : db.codexEntries.get(result.value))).toBeUndefined()
    expect(await db.codexCategories.where('parentId').equals(f.parent).count()).toBe(0)
    expect(await db.codexEntries.where('categoryId').equals(f.parent).count()).toBe(0)
  })

  it.each(['manual', 'adopt'] as const)('refuses a new category cycle through the real %s writer', async writer => {
    const f = await fixture()
    const child = await category(f.scope, '不能成为父级的新子分类', f.parent)
    const before = await rawDatabase()
    if (writer === 'manual') await expect(useCodexStore.getState().updateCategory(f.parent, { parentId: child })).rejects.toThrow()
    else {
      const result = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'codexCategories',
        recordId: f.parent, mode: 'replace', data: { parentId: child } })
      expect(result.written).toEqual([])
      expect(result.fkErrors.length + result.skipped.length).toBeGreaterThan(0)
    }
    expect(await rawDatabase()).toEqual(before)
  })

  it('does not let a finished deletion replace a newer World view load', async () => {
    const f = await fixture(), other = await fixture()
    await useCodexStore.getState().loadExisting(f.scope)
    let nextView: Promise<void> | undefined
    const observeCommit = (key: unknown, _row: unknown, transaction: Transaction) => {
      if (key === f.parent) {
        transaction.on('complete', () => {
          nextView = useCodexStore.getState().loadExisting(other.scope)
          void nextView.catch(() => undefined)
        })
      }
    }
    db.codexCategories.hook('deleting', observeCommit)
    try {
      await useCodexStore.getState().deleteCategory(f.parent)
      expect(nextView).toBeDefined()
      await nextView
    } finally { db.codexCategories.hook('deleting').unsubscribe(observeCommit) }
    expect(useCodexStore.getState().loadedScope).toEqual(other.scope)
    expect(useCodexStore.getState().categories.map(row => row.id)).toEqual([other.parent, other.keep])
    expect(await db.codexCategories.get(f.parent)).toBeUndefined()
    expect(await db.codexEntries.get(other.known)).toBeDefined()
  })

  it.each(['codexCategories', 'codexEntries'] as const)('keeps the real adoption writer from recreating an orphan %s after deletion', async target => {
    const f = await fixture()
    await useCodexStore.getState().deleteCategory(f.parent)
    const before = await rawDatabase()
    const result = await adopt({ projectId: f.scope.projectId, scope: f.scope, target, mode: 'add',
      data: target === 'codexCategories' ? { domain: 'humanity', name: '晚到模型分类', parentId: f.parent, fieldSchema: '[]' }
        : { name: '晚到模型词条', categoryId: f.parent, summary: '候选内容', description: '不成为正式孤儿。', fields: '{}', refs: '{}' } })
    expect(result.written).toEqual([])
    expect(result.fkErrors.length + result.skipped.length).toBeGreaterThan(0)
    expect(await rawDatabase()).toEqual(before)
  })

  it.each(['none', 'native-failure', 'cycle'] as const)('shows actual CodexPanel deletion error=%s and preserves the full selected entry on failure', async damage => {
    const f = await fixture()
    if (damage === 'cycle') {
      const child = await category(f.scope, '旧损坏子分类', f.parent)
      await db.codexCategories.update(f.parent, { parentId: child })
    }
    const original = (await db.codexEntries.get(f.known))!
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const fail = (key: unknown) => { if (damage === 'native-failure' && key === f.parent) throw new Error('synthetic visible Codex deletion failure') }
    db.codexCategories.hook('deleting', fail)
    try {
      await act(async () => { root.render(createElement(ToastProvider, null, createElement(DialogProvider, null,
        createElement(CodexPanel, { project: f.project, fixedDomain: 'humanity', existingOnly: true })))) })
      const wait = async (assertion: () => void) => { await vi.waitFor(async () => { await act(async () => {}); assertion() }, { timeout: 2000, interval: 10 }) }
      await wait(() => { expect(useCodexStore.getState().loading).toBe(false); expect(host.textContent).toContain('作者选择删除的分类') })
      const card = [...host.querySelectorAll<HTMLElement>('div.group')].find(row => row.textContent?.includes('作者选择删除的分类'))!
      await act(async () => { card.click() })
      await wait(() => { expect(host.textContent).toContain('已有词条') })
      const item = [...host.querySelectorAll<HTMLElement>('div.group')].find(row => row.textContent?.includes('已有词条'))!
      await act(async () => { item.click() })
      await wait(() => { expect([...host.querySelectorAll('textarea')].some(row => row.value.replace(/\r\n/g, '\n') === original.description.replace(/\r\n/g, '\n'))).toBe(true) })
      const before = await rawDatabase()
      await act(async () => { card.querySelector<HTMLButtonElement>('button[title="删除自定义分类"]')!.click() })
      await wait(() => { expect(document.querySelector('[role="dialog"]')).not.toBeNull() })
      const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === '删除')!
      await act(async () => { confirm.click() })
      if (damage !== 'none') {
        const expectedError = damage === 'cycle' ? '层级不能指向自身' : 'synthetic visible Codex deletion failure'
        await wait(() => { expect(host.querySelector('[role="alert"]')?.textContent).toContain(expectedError) })
        expect(await rawDatabase()).toEqual(before)
        expect(await db.codexEntries.get(f.known)).toEqual(original)
        expect([...host.querySelectorAll('textarea')].some(row => row.value.replace(/\r\n/g, '\n') === original.description.replace(/\r\n/g, '\n'))).toBe(true)
      } else {
        await wait(() => { expect(host.textContent).not.toContain('作者选择删除的分类') })
        expect(await db.codexCategories.get(f.parent)).toBeUndefined()
        expect(await db.codexEntries.get(f.known)).toBeUndefined()
        expect(host.querySelector('[role="alert"]')).toBeNull()
      }
    } finally {
      await act(async () => { root.unmount() })
      host.remove()
      db.codexCategories.hook('deleting').unsubscribe(fail)
    }
  })
})
