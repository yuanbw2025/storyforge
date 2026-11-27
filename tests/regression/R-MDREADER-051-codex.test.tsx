import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CodexEntryDetail from '../../src/components/codex/CodexEntryDetail'
import { db } from '../../src/lib/db/schema'
import { useCodexStore } from '../../src/stores/codex'
import { parseEntryFields, stringifyEntryFields, stringifyFieldSchema } from '../../src/lib/types/codex'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
const raw = '# 详细原文\r\n\r\n**事实**：第七年。\r\n\r\n<script>globalThis.bad=1</script>\r\n![外图](https://blocked.invalid/image.png)\r\n  '
beforeEach(async () => { await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1(); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No external or model requests') })) })
afterEach(async () => {
  for (const ui of mounted.splice(0)) { await act(async () => ui.root.unmount()); ui.host.remove() }
  expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resetPendingEditCoordinatorForTestsV1(); await db.delete()
})
async function fixture() {
  const { scope } = await seedCurrentWorkspace()
  const categoryId = await useCodexStore.getState().addCategory({ projectId: scope.projectId, worldId: scope.worldId, domain: 'humanity', parentId: null,
    name: '地方知识', fieldSchema: stringifyFieldSchema([{ key: 'memo', label: '长文', type: 'longtext' }, { key: 'code', label: '代号', type: 'text' }, { key: 'count', label: '数量', type: 'number' }]), hidden: false, order: 0 })
  const id = await useCodexStore.getState().addEntry({ projectId: scope.projectId, worldId: scope.worldId, categoryId, name: '# 字面名称', icon: '', summary: '# 单行简介',
    description: raw, fields: stringifyEntryFields({ memo: '# 自定义长文\r\n\r\n保留全文。  ', code: '# 字面代号', count: '7' }), refs: '{}', tags: '[]', importance: 3, order: 0 })
  const category = (await db.codexCategories.get(categoryId))!, entry = (await db.codexEntries.get(id))!
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); mounted.push({ host, root })
  const save = vi.fn((patch, expected) => useCodexStore.getState().updateEntry(id, patch, { scope, expected }))
  await act(async () => root.render(<CodexEntryDetail entry={entry} category={category} allCategories={[category]} allEntries={[entry]} onChange={save} />))
  return { host, root, id, entry, save }
}
function view(host: HTMLElement, title: string) {
  return [...host.querySelectorAll<HTMLElement>('[data-markdown-read-view]')].find(node => node.querySelector('h1')?.textContent === title)!
}
async function click(host: HTMLElement, label: string) {
  await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent === label)!.click())
}
async function edit(area: HTMLTextAreaElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('renders only description and declared longtext, retains exact source, and never executes embedded HTML or loads images', async () => {
  const { host, id, entry, save } = await fixture()
  expect(host.querySelectorAll('[data-markdown-read-view]')).toHaveLength(2)
  expect([...host.querySelectorAll('input')].map(input => input.value)).toEqual(expect.arrayContaining(['# 字面名称', '# 单行简介', '# 字面代号', '7']))
  expect(host.querySelector('script')).toBeNull(); expect(host.querySelector('img')).toBeNull(); expect(Reflect.get(globalThis, 'bad')).toBeUndefined()
  await click(view(host, '详细原文'), '查看源码')
  expect(host.querySelector('[data-markdown-source]')?.textContent).toBe(raw)
  expect(await db.codexEntries.get(id)).toEqual(entry); expect(save).not.toHaveBeenCalled()
})
it('keeps a failed description in its source editor and returns to reading only after the real owner writer commits', async () => {
  const { host, id, entry } = await fixture()
  await click(view(host, '详细原文'), '编辑源码'); const area = host.querySelector('textarea')!
  await edit(area, '# 新描述\n\n仍是第七年。  ')
  const reject = () => { throw Error('codex-write-failure') }; db.codexEntries.hook('updating', reject)
  try { await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('codex-write-failure') }) }
  finally { db.codexEntries.hook('updating').unsubscribe(reject) }
  expect(host.querySelector('textarea')).toBe(area); expect(area.value).toBe('# 新描述\n\n仍是第七年。  ')
  expect((await db.codexEntries.get(id))?.description).toBe(entry.description)
  await act(async () => { await flushPendingEditsV1() })
  expect(view(host, '新描述')).toBeTruthy(); expect((await db.codexEntries.get(id))?.description).toBe('# 新描述\n\n仍是第七年。  ')
  expect((await db.codexEntries.get(id))?.fields).toBe(entry.fields)
})
it('merges a custom longtext edit through the existing draft coordinator without replacing other fields', async () => {
  const { host, id, entry } = await fixture()
  await click(view(host, '自定义长文'), '编辑源码'); await edit(host.querySelector('textarea')!, '# 长文已改\n\n仅修改此项。  ')
  await act(async () => { await flushPendingEditsV1() })
  const saved = (await db.codexEntries.get(id))!
  expect(parseEntryFields(saved.fields)).toEqual({ memo: '# 长文已改\n\n仅修改此项。  ', code: '# 字面代号', count: '7' })
  expect(saved.description).toBe(entry.description); expect(saved.name).toBe(entry.name)
  expect(view(host, '长文已改')).toBeTruthy()
})
it('holds the source editor during composition and commits the final composition text through the original draft writer', async () => {
  const { host, id, save } = await fixture(); await click(view(host, '详细原文'), '编辑源码')
  const area = host.querySelector('textarea')!
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  await edit(area, '# 中文尾字🌊')
  await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('输入法') })
  expect(save).not.toHaveBeenCalled(); expect(host.querySelector('textarea')).toBe(area)
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await act(async () => { await flushPendingEditsV1() })
  expect((await db.codexEntries.get(id))?.description).toBe('# 中文尾字🌊'); expect(view(host, '中文尾字🌊')).toBeTruthy()
})
