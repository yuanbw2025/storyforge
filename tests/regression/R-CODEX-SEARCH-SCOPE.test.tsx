import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import CodexSearchBar from '../../src/components/codex/CodexSearchBar'
import { useCodexStore } from '../../src/stores/codex'
import type { CodexCategory, CodexEntry } from '../../src/lib/types/codex'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const scope = { projectId: 1, worldId: 11, workId: 12 }
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  useCodexStore.setState({ loadedScope: scope, categories: [{ id: 21, projectId: 1, builtInKey: 'herb', name: '灵植草药', fieldSchema: '[]' }] as CodexCategory[],
    entries: [{ id: 31, projectId: 1, categoryId: 21, name: '同名甲界草', summary: '', fields: '{}', worldGroupId: 7 }, { id: 32, projectId: 1, categoryId: 21, name: '同名乙界草', summary: '', fields: '{}', worldGroupId: 8 }] as CodexEntry[] })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function search() {
  await act(async () => root.render(createElement(CodexSearchBar, { categoryKeys: ['herb'], scope, worldGroupId: 7 })))
  const input = host.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '同名')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('searches only the selected group in the current World', async () => {
  await search()
  expect(host.textContent).toContain('同名甲界草')
  expect(host.textContent).not.toContain('同名乙界草')
})
it('cannot present the next World cache through the previous World frame', async () => {
  await search()
  await act(async () => useCodexStore.setState({ loadedScope: { ...scope, worldId: 99 } }))
  expect(host.textContent).not.toContain('同名甲界草')
  expect(host.textContent).not.toContain('同名乙界草')
})
