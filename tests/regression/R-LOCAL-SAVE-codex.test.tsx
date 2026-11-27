import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CodexEntryDetail from '../../src/components/codex/CodexEntryDetail'
import type { SaveCodexDraft } from '../../src/components/codex/useCodexEntryDraft'
import { db } from '../../src/lib/db/schema'
import { useCodexStore } from '../../src/stores/codex'
import { createCodexLocalSaveWitnessV1, matchingCodexLocalSaveIdentityV1 } from '../../src/lib/authoring/codex-local-save-evidence'
import { stringifyEntryFields, stringifyFieldSchema } from '../../src/lib/types/codex'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
beforeEach(async () => { await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1(); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model or external requests') })) })
afterEach(async () => {
  for (const ui of mounted.splice(0)) { await act(async () => ui.root.unmount()); ui.host.remove() }
  expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resetPendingEditCoordinatorForTestsV1(); await db.delete()
})
async function waitFor(check: () => void | Promise<void>) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }); await check() })
}
const status = (host: HTMLElement) => host.querySelector('[data-codex-local-save-status]')?.getAttribute('data-codex-local-save-status')
async function fixture(saveOverride?: SaveCodexDraft) {
  const { scope } = await seedCurrentWorkspace('050 Codex local save')
  await useCodexStore.getState().loadExisting(scope)
  const categoryId = await useCodexStore.getState().addCategory({ projectId: scope.projectId, domain: 'humanity', parentId: null,
    name: '保存验收', fieldSchema: stringifyFieldSchema([{ key: 'memo', label: '长文', type: 'longtext' }]), hidden: false, order: 0 })
  const id = await useCodexStore.getState().addEntry({ projectId: scope.projectId, categoryId, name: '旧名称', summary: '原简介',
    description: '# 旧描述\r\n\r\n军税17枚。  ', fields: stringifyEntryFields({ memo: '# 旧长文\r\n  ' }), refs: '{}', tags: '[]', order: 0 })
  const category = (await db.codexCategories.get(categoryId))!
  const save: SaveCodexDraft = saveOverride ?? ((patch, expected) => useCodexStore.getState().updateEntry(id, patch, { scope, expected }))
  function Consumer() {
    const state = useCodexStore(), entry = state.entries.find(row => row.id === id)
    return entry ? <CodexEntryDetail entry={entry} category={category} allCategories={[category]} allEntries={state.entries}
      onChange={save} localSave={{ scope, witness: state.localSaveWitnesses[id] ?? null }} /> : null
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); mounted.push({ host, root })
  await act(async () => root.render(<Consumer />))
  await waitFor(() => expect(status(host)).toBe('saved'))
  return { host, root, scope, id, categoryId, save, Consumer }
}
async function click(host: HTMLElement, text: string) {
  const element = [...host.querySelectorAll('button')].find(button => button.textContent === text)!
  expect(element).toBeTruthy(); await act(async () => element.click())
}
async function edit(area: HTMLInputElement | HTMLTextAreaElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(area instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(area, text)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function source(host: HTMLElement, key: string) { return host.querySelector<HTMLElement>(`[data-codex-source-field="${key}"]`)! }

it('initial source is confirmed only from an actual DB witness and source viewing causes no write', async () => {
  const { host, scope, id } = await fixture(), before = (await db.codexEntries.get(id))!
  expect(useCodexStore.getState().localSaveWitnesses[id]).toMatchObject({ source: 'committed-write', recordId: id })
  await click(source(host, 'description'), '查看源码')
  expect(source(host, 'description').querySelector('[data-markdown-source]')?.textContent).toBe(before.description)
  expect(await db.codexEntries.get(id)).toEqual(before)
  await act(async () => useCodexStore.getState().loadExisting(scope))
  await waitFor(() => expect(status(host)).toBe('saved'))
  expect(useCodexStore.getState().localSaveWitnesses[id]?.source).toBe('database-read')
})
it.each(['description', 'field:memo'])('%s input invalidates saved before blur, commits exact source and preserves other fields', async key => {
  const { host, scope, id } = await fixture(), before = (await db.codexEntries.get(id))!
  await click(source(host, key), '编辑源码')
  await edit(source(host, key).querySelector('textarea')!, '# 新稿\r\n\r\n17枚，不可夜航。　 ')
  expect(status(host)).toBe('dirty')
  expect(await db.codexEntries.get(id)).toEqual(before)
  await act(async () => flushPendingEditsV1())
  await waitFor(() => expect(status(host)).toBe('saved'))
  const saved = (await db.codexEntries.get(id))!
  expect(key === 'description' ? saved.description : JSON.parse(saved.fields).memo).toBe('# 新稿\r\n\r\n17枚，不可夜航。　 ')
  expect(saved.name).toBe(before.name)
  expect(key === 'description' ? saved.fields : saved.description).toBe(key === 'description' ? before.fields : before.description)
  db.close(); await db.open(); await act(async () => useCodexStore.getState().loadExisting(scope))
  await waitFor(() => expect(status(host)).toBe('saved'))
})
it('a failed native write retains source and status; the visible retry resolves both field and record drafts', async () => {
  const { host, id } = await fixture(), before = (await db.codexEntries.get(id))!
  await click(source(host, 'description'), '编辑源码'); await edit(source(host, 'description').querySelector('textarea')!, '# 未提交原稿')
  const fault = () => { throw new DOMException('codex quota', 'QuotaExceededError') }; db.codexEntries.hook('updating', fault)
  try { await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('codex quota') }) }
  finally { db.codexEntries.hook('updating').unsubscribe(fault) }
  expect(status(host)).toBe('failed'); expect(source(host, 'description').querySelector('textarea')?.value).toBe('# 未提交原稿')
  expect(await db.codexEntries.get(id)).toEqual(before)
  await click(host, '重试保存词条')
  await waitFor(() => expect(status(host)).toBe('saved'))
  expect(source(host, 'description').querySelector('textarea')).toBeNull()
  expect(host.textContent).not.toContain('输入已保留')
  expect((await db.codexEntries.get(id))?.description).toBe('# 未提交原稿')
})
it('a resolved void callback cannot fabricate a committed save badge', async () => {
  const { host, id } = await fixture(async () => undefined), before = (await db.codexEntries.get(id))!
  await edit(host.querySelector<HTMLInputElement>('[placeholder="名称"]')!, '尚未真实写入')
  await act(async () => flushPendingEditsV1())
  await waitFor(() => expect(status(host)).toBe('unconfirmed'))
  expect(await db.codexEntries.get(id)).toEqual(before)
})
it('Escape that actually cancels a local source draft restores the original confirmed record status', async () => {
  const { host, id } = await fixture(), before = (await db.codexEntries.get(id))!
  await click(source(host, 'description'), '编辑源码'); const area = source(host, 'description').querySelector('textarea')!
  await edit(area, '# 可放弃的修改'); expect(status(host)).toBe('dirty')
  await act(async () => area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await waitFor(() => expect(status(host)).toBe('saved'))
  expect(source(host, 'description').querySelector('textarea')).toBeNull(); expect(await db.codexEntries.get(id)).toEqual(before)
})
it('a wrong post-commit value never publishes a success witness or destroys the retained author draft', async () => {
  const { host, id } = await fixture(), oldWitness = useCodexStore.getState().localSaveWitnesses[id]
  await click(source(host, 'description'), '编辑源码'); await edit(source(host, 'description').querySelector('textarea')!, '# 作者希望保存')
  const corrupt = () => ({ description: 'synthetic wrong poststate' }); db.codexEntries.hook('updating', corrupt)
  try { await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('未确认保存') }) }
  finally { db.codexEntries.hook('updating').unsubscribe(corrupt) }
  expect(status(host)).toBe('failed'); expect(useCodexStore.getState().localSaveWitnesses[id]).toEqual(oldWitness)
  expect(source(host, 'description').querySelector('textarea')?.value).toBe('# 作者希望保存')
})
it('rejects foreign scope and recreated UID witnesses, and category deletion removes ephemeral proof with its record', async () => {
  const { scope, id, categoryId } = await fixture(), row = (await db.codexEntries.get(id))!
  const witness = (await createCodexLocalSaveWitnessV1(row, scope, 'database-read'))!
  expect(matchingCodexLocalSaveIdentityV1(row, { scope, witness })).toBe(true)
  expect(matchingCodexLocalSaveIdentityV1(row, { scope: { ...scope, worldId: scope.worldId + 1 }, witness })).toBe(false)
  expect(matchingCodexLocalSaveIdentityV1({ ...row, ragDocumentId: 'different' }, { scope, witness })).toBe(false)
  await act(async () => useCodexStore.getState().deleteCategory(categoryId))
  expect(await db.codexEntries.get(id)).toBeUndefined(); expect(useCodexStore.getState().localSaveWitnesses[id]).toBeUndefined()
})

it('an earlier committed receipt cannot confirm later typing while the original queue is still draining', async () => {
  let release!: () => void, firstCommitted = false, calls = 0
  const selectedScope: { current?: Awaited<ReturnType<typeof seedCurrentWorkspace>>['scope'] } = {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await fixture(async (patch, expected) => {
    const row = await useCodexStore.getState().updateEntry(expected!.id!, patch, { scope: selectedScope.current!, expected })
    if (++calls === 1) { firstCommitted = true; await gate }
    return row
  })
  selectedScope.current = f.scope
  const name = f.host.querySelector<HTMLInputElement>('[placeholder="名称"]')!
  await edit(name, '第一稿')
  await waitFor(() => expect(firstCommitted).toBe(true))
  await edit(name, '第二稿')
  expect((await db.codexEntries.get(f.id))?.name).toBe('第一稿')
  expect(status(f.host)).not.toBe('saved'); expect(name.value).toBe('第二稿')
  await act(async () => { release(); await flushPendingEditsV1() })
  await waitFor(() => expect(status(f.host)).toBe('saved'))
  expect((await db.codexEntries.get(f.id))?.name).toBe('第二稿'); expect(calls).toBe(2)
})
it('keeps an unhashable legacy row readable while withholding its saved witness', async () => {
  const { scope, id } = await fixture()
  await db.codexEntries.update(id, { importance: 5n } as never)
  await act(async () => useCodexStore.getState().loadExisting(scope))
  expect(useCodexStore.getState().loadError).toBeNull()
  expect(useCodexStore.getState().entries.find(entry => entry.id === id)).toBeDefined()
  expect(useCodexStore.getState().localSaveWitnesses[id]).toBeUndefined()
})

it('empty longtext input survives the parent source-status capture and commits exact text', async () => {
  const { host, scope, id } = await fixture()
  await db.codexEntries.update(id, { description: '', fields: '{}' })
  await act(async () => useCodexStore.getState().loadExisting(scope))
  await waitFor(() => expect(status(host)).toBe('saved'))
  const leaf = source(host, 'field:memo')
  await act(async () => leaf.querySelector<HTMLElement>('.cursor-text')!.click())
  const area = leaf.querySelector('textarea')!
  await edit(area, '# 完整原文\n\n尾部空格。  ')
  expect(area.value).toBe('# 完整原文\n\n尾部空格。  ')
  expect(status(host)).toBe('dirty')
  await act(async () => flushPendingEditsV1())
  await waitFor(() => expect(status(host)).toBe('saved'))
  expect(JSON.parse((await db.codexEntries.get(id))!.fields).memo).toBe('# 完整原文\n\n尾部空格。  ')
})
