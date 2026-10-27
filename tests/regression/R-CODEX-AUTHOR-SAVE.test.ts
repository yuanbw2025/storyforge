import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCodexStore } from '../../src/stores/codex'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { coordinatePendingEditV1, flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { generateCodexEnrichmentCandidateV1 } from '../../src/lib/agent/run/codex-extraction-durable'
import { BUILTIN_CATEGORIES, codexCategoryFormatIssueV1, codexEntryFormatIssueV1, stringifyFieldSchema } from '../../src/lib/types/codex'

beforeEach(async () => {
  await db.delete(); await db.open()
  resetPendingEditCoordinatorForTestsV1()
  useCodexStore.setState({ categories: [], entries: [], loading: false, loadedProjectId: null, loadedScope: null, loadError: null })
})
afterEach(() => { vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1() })
async function fixture(name = '原来的作品') {
  const { scope } = await seedCurrentWorkspace(name)
  await useCodexStore.getState().loadAll(scope)
  const categoryId = useCodexStore.getState().categories.find(row => row.builtInKey === 'mineral')!.id!
  const id = await useCodexStore.getState().addEntry({ projectId: scope.projectId, categoryId, name: '响盐', summary: '旧简介', description: '', fields: '{}', refs: '{}', order: 0 })
  return { scope, id, categoryId, original: (await db.codexEntries.get(id))! }
}

describe('Codex author persistence acknowledgement', () => {
  it('preserves all 21 built-in schemas while rejecting corrupt and duplicate definitions', () => {
    for (const category of BUILTIN_CATEGORIES) expect(codexCategoryFormatIssueV1({ fieldSchema: stringifyFieldSchema(category.fields) })).toBeNull()
    for (const fieldSchema of ['[null]', '{}', '[{"key":"x","label":"","type":"text"}]', '[{"key":"x","label":"甲","type":"select","options":1}]', '[{"key":"x","label":"甲","type":"text"},{"key":"x","label":"乙","type":"text"}]']) {
      expect(codexCategoryFormatIssueV1({ fieldSchema })).toBeTruthy()
    }
  })
  it.each([{ refs: '{"craftInto":1}' }, { fields: '{"appearance":{}}' }, { tags: '[{}]' }])('refuses a corrupt structured patch instead of replacing or coercing it', async patch => {
    const { id, scope, original } = await fixture()
    expect(codexEntryFormatIssueV1({ ...original, ...patch })).toBeTruthy()
    await expect(useCodexStore.getState().updateEntry(id, patch, { scope })).rejects.toThrow('词条格式异常')
    expect(await db.codexEntries.get(id)).toEqual(original)
  })
  it('blocks generation before any provider call when a category definition is corrupt', async () => {
    const { scope, categoryId } = await fixture()
    await db.codexCategories.update(categoryId, { fieldSchema: '[null]' })
    const runAI = vi.fn()
    await expect(generateCodexEnrichmentCandidateV1({ scope, request: { categoryId, worldGroupId: null, authorRequest: '补全盐镇探路所需矿物', supplementTags: false }, runAI })).rejects.toThrow('词条格式异常')
    expect(runAI).not.toHaveBeenCalled()
    expect((await db.codexCategories.get(categoryId))!.fieldSchema).toBe('[null]')
  })
  it('persists clearing and returns the complete canonical acknowledgement', async () => {
    const { scope, id, original } = await fixture()
    const written = await useCodexStore.getState().updateEntry(id, { summary: '', fields: '{"appearance":"蓝盐","effect":"回声"}' }, { scope, expected: original })
    expect(written).toEqual(await db.codexEntries.get(id))
    await useCodexStore.getState().loadAll(scope)
    expect(useCodexStore.getState().entries[0].summary).toBe('')
    expect(JSON.parse(written.fields)).toEqual({ appearance: '蓝盐', effect: '回声' })
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
  })
  it.each(['projectId', 'worldId', 'id', 'origin', 'producerRunId', 'updatedAt'])('rejects forbidden %s without changing provenance or owner', async key => {
    const { scope, id, original } = await fixture()
    await expect(useCodexStore.getState().updateEntry(id, { [key]: 999 }, { scope })).rejects.toThrow('非作者字段')
    expect(await db.codexEntries.get(id)).toEqual(original)
  })
  it('rejects a semantic conflict even if both records have the same timestamp', async () => {
    const { scope, id, original } = await fixture()
    await db.codexEntries.update(id, { summary: '另一页面的作者原文' })
    await expect(useCodexStore.getState().updateEntry(id, { summary: '旧页面的输入' }, { scope, expected: original })).rejects.toThrow('其他页面修改')
    expect((await db.codexEntries.get(id))!.summary).toBe('另一页面的作者原文')
  })
  it('merges an unrelated concurrently changed field instead of overwriting it', async () => {
    const { scope, id, original } = await fixture()
    await db.codexEntries.update(id, { description: '另一页面的新描述' })
    const written = await useCodexStore.getState().updateEntry(id, { summary: '当前简介' }, { scope, expected: original })
    expect(written.description).toBe('另一页面的新描述')
  })
  it('rejects a deleted record and a zero-row acknowledgement', async () => {
    const { scope, id } = await fixture()
    const update = vi.spyOn(db.codexEntries, 'update').mockResolvedValueOnce(0)
    await expect(useCodexStore.getState().updateEntry(id, { name: '未写入' }, { scope })).rejects.toThrow('尚未保存')
    update.mockRestore(); await db.codexEntries.delete(id)
    await expect(useCodexStore.getState().updateEntry(id, { name: '不能复活' }, { scope })).rejects.toThrow('已删除')
    expect(await db.codexEntries.get(id)).toBeUndefined()
  })
  it('rejects cross-workspace record, category and group assignments atomically', async () => {
    const a = await fixture('A'), b = await fixture('B')
    await expect(useCodexStore.getState().updateEntry(a.id, { name: '误投' }, { scope: b.scope })).rejects.toThrow('原来的 World')
    await expect(useCodexStore.getState().updateEntry(a.id, { categoryId: b.categoryId }, { scope: a.scope })).rejects.toThrow('分类不属于')
    const groupId = await db.worldGroups.add({ projectId: b.scope.projectId, worldId: b.scope.worldId, name: 'B 世界', type: 'primary', description: '', order: 0, createdAt: 1, updatedAt: 1 } as never)
    await expect(useCodexStore.getState().updateEntry(a.id, { worldGroupId: groupId }, { scope: a.scope })).rejects.toThrow('分组不属于')
    expect(await db.codexEntries.get(a.id)).toEqual(a.original)
  })
  it('preserves the original scope while queued and never pollutes the next workspace cache', async () => {
    const a = await fixture('A')
    let release!: () => void
    const barrier = coordinatePendingEditV1({ key: `codex-entry:${a.id}`, persist: () => new Promise<void>(resolve => { release = resolve }) })
    await Promise.resolve()
    const pending = useCodexStore.getState().updateEntry(a.id, { summary: '属于 A 的输入' })
    const b = await fixture('B')
    release(); await barrier; await pending
    expect((await db.codexEntries.get(a.id))!.summary).toBe('属于 A 的输入')
    expect(useCodexStore.getState().loadedScope).toEqual(b.scope)
    expect(useCodexStore.getState().entries.map(row => row.id)).toEqual([b.id])
  })
  it('keeps a late create acknowledgement out of the next workspace cache', async () => {
    const a = await fixture('A')
    const add = db.codexEntries.add.bind(db.codexEntries)
    let release!: () => void
    vi.spyOn(db.codexEntries, 'add').mockImplementationOnce(async row => {
      await new Promise<void>(resolve => { release = resolve })
      return add(row)
    })
    const pending = useCodexStore.getState().addEntry({ projectId: a.scope.projectId, categoryId: a.categoryId, name: '迟到的新词条', summary: '', description: '', fields: '{}', refs: '{}', order: 1 })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const b = await fixture('B')
    release(); const id = await pending
    expect((await db.codexEntries.get(id))!.projectId).toBe(a.scope.projectId)
    expect(useCodexStore.getState().entries.map(row => row.id)).toEqual([b.id])
  })
  it('keeps a read failure visible with the last canonical data, then clears it on retry', async () => {
    const { scope, original } = await fixture()
    vi.spyOn(db.codexEntries, 'where').mockImplementationOnce(() => { throw new Error('词条读取故障') })
    await useCodexStore.getState().loadAll(scope)
    expect(useCodexStore.getState()).toMatchObject({ loading: false, loadError: '词条读取故障', entries: [original] })
    await useCodexStore.getState().loadAll(scope)
    expect(useCodexStore.getState()).toMatchObject({ loading: false, loadError: null })
  })
  it('ignores an older scope resolution after a newer workspace has loaded', async () => {
    const a = await fixture('A'), b = await fixture('B')
    const get = db.projects.get.bind(db.projects)
    let release!: () => void
    vi.spyOn(db.projects, 'get').mockImplementationOnce(async key => {
      await new Promise<void>(resolve => { release = resolve })
      return get(key)
    })
    const old = useCodexStore.getState().loadAll(a.scope)
    await useCodexStore.getState().loadAll(b.scope)
    release(); await old
    expect(useCodexStore.getState().loadedScope).toEqual(b.scope)
    expect(useCodexStore.getState().entries.map(row => row.id)).toEqual([b.id])
  })
})
