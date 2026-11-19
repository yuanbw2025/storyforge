import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InlineTextarea, type InlineSave } from '../../src/components/shared/InlineEdit'
import { db } from '../../src/lib/db/schema'
import { useWorldviewStore } from '../../src/stores/worldview'
import { type LocalSaveAckV1, type LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import type { WorkspaceScope } from '../../src/lib/types'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = []
beforeEach(async () => { await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1() })
afterEach(async () => { vi.useRealTimers(); for (const ui of mounted.splice(0)) { await act(async () => ui.root.unmount()); ui.host.remove() } resetPendingEditCoordinatorForTestsV1(); vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close() })
const raw = '  # 世界🌊\r\n\r\n正文 **重点** 与 [锚点](#local)\r\n\r\n```text\r\n  |-- A  \r\n```\r\n  '
async function fixture(text = raw) {
  const { scope } = await seedCurrentWorkspace('051 N5 isolated component')
  await useWorldviewStore.getState().loadAll(scope)
  if (text) {
    const expected = useWorldviewStore.getState().localSaveWitnesses.worldStructure!
    await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: text }, scope, { kind: 'natural-field-local-save-v1', expected, session: 'seed', generation: 1 })
  }
  return scope
}
async function mount(element: React.ReactNode) { const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); mounted.push({ host, root }); await act(async () => root.render(element)); return { host, root } }
function Consumer({ scope, writer, markdownRead = true }: { scope: WorkspaceScope; writer?: InlineSave; markdownRead?: boolean }) {
  const state = useWorldviewStore(); const identity = { ...scope, table: 'worldviews' as const, field: 'worldStructure' as const, worldGroupId: null }
  const save: InlineSave = writer ?? ((value, intent) => state.saveWorldview({ projectId: scope.projectId, worldStructure: value }, scope, intent!))
  return <InlineTextarea value={state.worldview?.worldStructure ?? ''} onChange={save} markdownRead={markdownRead}
    localSave={{ identity, witness: state.localSaveWitnesses.worldStructure ?? null }} inputAreaLayout={{ enabled: true, preferenceKey: 'world.structure/current' }} />
}
async function button(host: HTMLElement, name: string) { await act(async () => [...host.querySelectorAll('button')].find(el => el.textContent === name)!.click()) }
async function edit(area: HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value); area.dispatchEvent(new Event('input', { bubbles: true })) }) }
const read = (host: HTMLElement) => host.querySelector('[data-markdown-read-view]')
it('makes real registered N5 content readable without a competing parent click: selection, source/copy, anchors and double-click never begin or save', async () => {
  const scope = await fixture(); const write = vi.fn(); const copy = vi.fn().mockResolvedValue(undefined); vi.stubGlobal('navigator', { clipboard: { writeText: copy } })
  const ui = await mount(<Consumer scope={scope} writer={write} />); vi.useFakeTimers()
  expect(read(ui.host)).not.toBeNull(); expect(ui.host.querySelector('h1')?.textContent).toBe('世界🌊')
  await button(ui.host, '查看源码'); expect(ui.host.querySelector('[data-markdown-source]')?.textContent).toBe(raw); expect(ui.host.querySelector('textarea')).toBeNull()
  await button(ui.host, '复制源码'); expect(copy).toHaveBeenCalledExactlyOnceWith(raw); expect(ui.host.querySelector('textarea')).toBeNull()
  await button(ui.host, '返回阅读'); const paragraph = ui.host.querySelector('[data-markdown-body] p')!
  const range = document.createRange(); range.selectNodeContents(paragraph); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
  await act(async () => { paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); vi.advanceTimersByTime(300) })
  expect(ui.host.querySelector('textarea')).toBeNull(); window.getSelection()!.removeAllRanges()
  await act(async () => { paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); paragraph.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })); vi.advanceTimersByTime(300) })
  expect(ui.host.querySelector('textarea')).toBeNull()
  const anchor = ui.host.querySelector('a')!; anchor.addEventListener('click', event => event.preventDefault())
  await act(async () => { anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); vi.advanceTimersByTime(300) })
  expect(ui.host.querySelector('textarea')).toBeNull(); expect(write).not.toHaveBeenCalled()
  await act(async () => { paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); vi.advanceTimersByTime(300) })
  expect(ui.host.querySelector('textarea')).not.toBeNull(); expect(write).not.toHaveBeenCalled()
})
it('keeps original CRLF and the entire row unchanged when source editing only selects then flushes without author input', async () => {
  const scope = await fixture(); const before = JSON.stringify(await db.worldviews.toArray()); const write = vi.fn()
  const ui = await mount(<Consumer scope={scope} writer={write} />); await button(ui.host, '编辑源码')
  const area = ui.host.querySelector('textarea')!; area.setSelectionRange(2, 8)
  await act(async () => flushPendingEditsV1())
  expect(write).not.toHaveBeenCalled(); expect(JSON.stringify(await db.worldviews.toArray())).toBe(before); expect(read(ui.host)).not.toBeNull()
})
it('preserves the actual textarea through IME and a simulated failure, then returns to reading only after the real writer ack', async () => {
  const scope = await fixture(); let fail = true
  const writer = vi.fn((value: string, intent?: LocalSaveIntentV1) => fail ? Promise.reject(new Error('controlled failure')) : useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: value }, scope, intent!))
  const ui = await mount(<Consumer scope={scope} writer={writer} />); await button(ui.host, '编辑源码'); const area = ui.host.querySelector('textarea')!
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))); await edit(area, '# 中文尾字🌊')
  await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('输入法') }); expect(writer).not.toHaveBeenCalled(); expect(ui.host.querySelector('textarea')).toBe(area)
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('controlled failure') }); expect(read(ui.host)).toBeNull(); expect(ui.host.querySelector('textarea')).toBe(area)
  fail = false; await act(async () => flushPendingEditsV1()); expect(read(ui.host)).not.toBeNull(); expect((await db.worldviews.toArray())[0].worldStructure).toBe('# 中文尾字🌊')
})
it('holds the same textarea for new dirty text after a prior real committed ack and drains latest before returning to reading', async () => {
  const scope = await fixture(); let release!: (ack: LocalSaveAckV1) => void; let firstAck!: LocalSaveAckV1; let calls = 0
  const writer: InlineSave = async (value, intent) => { const ack = await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: value }, scope, intent!); calls++; if (calls === 1) { firstAck = ack; return new Promise<LocalSaveAckV1>(resolve => { release = resolve }) } return ack }
  const ui = await mount(<Consumer scope={scope} writer={writer} />); await button(ui.host, '编辑源码'); const area = ui.host.querySelector('textarea')!; await edit(area, '# first')
  let pending!: Promise<unknown>; await act(async () => { pending = flushPendingEditsV1(); await vi.waitFor(() => expect(release).toBeTypeOf('function')) })
  await edit(area, '# latest'); expect(ui.host.querySelector('textarea')).toBe(area); expect(read(ui.host)).toBeNull()
  await act(async () => { release(firstAck); await pending })
  expect(calls).toBe(2); expect(read(ui.host)).not.toBeNull(); expect((await db.worldviews.toArray())[0].worldStructure).toBe('# latest')
})
it('keeps non-admitted/empty/invalid fields on their existing behavior and never interprets a placeholder as source', async () => {
  const scope = await fixture(); const ui = await mount(<Consumer scope={scope} markdownRead={false} />); expect(read(ui.host)).toBeNull()
  const save = vi.fn(); await act(async () => ui.root.render(<InlineTextarea markdownRead value="# no evidence" onChange={save} />)); expect(read(ui.host)).toBeNull()
  await act(async () => ui.root.render(<InlineTextarea markdownRead value="" placeholder="# placeholder" onChange={save} />)); expect(read(ui.host)).toBeNull(); expect(ui.host.textContent).toContain('# placeholder')
  await act(async () => ui.root.render(<InlineTextarea markdownRead value={{ bad: true } as unknown as string} onChange={save} />)); expect(ui.host.querySelector('[role="alert"]')).not.toBeNull(); expect(ui.host.querySelector('textarea')).toBeNull(); expect(save).not.toHaveBeenCalled()
})
