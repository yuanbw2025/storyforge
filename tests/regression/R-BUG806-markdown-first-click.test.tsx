import { act, createElement, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { InlineTextarea } from '../../src/components/shared/InlineEdit'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
type Props = ComponentProps<typeof InlineTextarea>
const mounted: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = []
afterEach(async () => {
  for (const ui of mounted.splice(0)) { await act(async () => ui.root.unmount()); ui.host.remove() }
  vi.useRealTimers(); vi.restoreAllMocks()
})
const identity = { projectId: 11, worldId: 12, workId: 13, worldGroupId: null, table: 'worldviews' as const, field: 'worldStructure' as const }
async function mount(props: Props) {
  vi.useFakeTimers()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  const render = async (next: Props) => { await act(async () => root.render(createElement(InlineTextarea, next))) }
  await render(props); window.getSelection()?.removeAllRanges()
  const click = async () => {
    const text = host.querySelector('[data-markdown-body] h1')
    expect(text).not.toBeNull()
    await act(async () => { text!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })) })
  }
  const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms) }) }
  return { host, root, render, click, advance }
}
it('keeps one ordinary first click across an unchanged parent render without saving', async () => {
  const save = vi.fn(), props: Props = { value: '# 原稿', onChange: save, markdownRead: true }
  const ui = await mount(props)
  await ui.click(); await ui.advance(100); await ui.render({ ...props }); await ui.advance(141)
  expect(ui.host.querySelector('textarea')?.value).toBe(props.value)
  expect(save).not.toHaveBeenCalled()
})
it('keeps the same registered field through a fresh contract object and inline writer render', async () => {
  const first = vi.fn(), latest = vi.fn(), props: Props = { value: '# 原稿', onChange: first, markdownRead: true, localSave: { identity, witness: null } }
  const ui = await mount(props)
  await ui.click(); await ui.advance(100)
  await ui.render({ ...props, onChange: latest, localSave: { identity: { ...identity }, witness: null } }); await ui.advance(141)
  expect(ui.host.querySelector('textarea')?.value).toBe(props.value)
  expect(first).not.toHaveBeenCalled(); expect(latest).not.toHaveBeenCalled()
})
it('cancels a pending click when the raw source changes, then edits only the new source', async () => {
  const save = vi.fn(), props: Props = { value: '# 原稿', onChange: save, markdownRead: true }
  const ui = await mount(props)
  await ui.click(); await ui.advance(100); await ui.render({ ...props, value: '# 新原稿' }); await ui.advance(141)
  expect(ui.host.querySelector('textarea')).toBeNull()
  await ui.click(); await ui.advance(241)
  expect(ui.host.querySelector('textarea')?.value).toBe('# 新原稿'); expect(save).not.toHaveBeenCalled()
})
it('cancels a pending click on equal-text owner changes instead of editing a different target', async () => {
  const save = vi.fn(), props: Props = { value: '# 相同文本', onChange: save, markdownRead: true, localSave: { identity, witness: null } }
  const ui = await mount(props)
  await ui.click(); await ui.advance(100)
  await ui.render({ ...props, localSave: { identity: { ...identity, worldId: 22 }, witness: null } }); await ui.advance(141)
  expect(ui.host.querySelector('textarea')).toBeNull()
  await ui.click(); await ui.advance(241)
  expect(ui.host.querySelector('textarea')?.value).toBe(props.value); expect(save).not.toHaveBeenCalled()
})
it('keeps the existing writer-change boundary for consumers without a registered save identity', async () => {
  const first = vi.fn(), next = vi.fn(), props: Props = { value: '# 原稿', onChange: first, markdownRead: true }
  const ui = await mount(props)
  await ui.click(); await ui.advance(100); await ui.render({ ...props, onChange: next }); await ui.advance(141)
  expect(ui.host.querySelector('textarea')).toBeNull()
  expect(first).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled()
})
it('does not edit or write after unmount while a single click is pending', async () => {
  const save = vi.fn(), ui = await mount({ value: '# 原稿', onChange: save, markdownRead: true })
  await ui.click(); await ui.advance(100); await act(async () => ui.root.unmount())
  mounted.splice(mounted.findIndex(item => item.root === ui.root), 1)
  await ui.advance(141); expect(ui.host.childNodes).toHaveLength(0); expect(save).not.toHaveBeenCalled(); ui.host.remove()
})
