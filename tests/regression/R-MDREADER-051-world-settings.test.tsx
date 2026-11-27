import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InlineTextarea } from '../../src/components/shared/InlineEdit'
import { db } from '../../src/lib/db/schema'
import { useWorldviewStore } from '../../src/stores/worldview'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import type { WorkspaceScope } from '../../src/lib/types'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = []
const source = '# 原始🌊\r\n\r\n**事实**：第七年。\r\n\r\n```text\r\n|-- 原文  \r\n```\r\n  '
beforeEach(async () => { await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1(); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No external requests') })) })
afterEach(async () => {
  for (const ui of mounted.splice(0)) { await act(async () => ui.root.unmount()); ui.host.remove() }
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); resetPendingEditCoordinatorForTestsV1(); await db.delete()
})
type Field = 'worldOrigin' | 'races' | 'divineNames'
function Consumer({ scope, field }: { scope: WorkspaceScope; field: Field }) {
  const state = useWorldviewStore()
  const value = field === 'divineNames' ? state.worldview?.divineDesign?.divineNames : state.worldview?.[field]
  return <InlineTextarea markdownRead value={value ?? ''} onChange={text => state.saveWorldview({ projectId: scope.projectId,
    ...(field === 'divineNames' ? { divineDesign: { divineNames: text } } : { [field]: text }),
  }, scope)} />
}
async function mount(scope: WorkspaceScope, field: Field) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  mounted.push({ root, host }); await act(async () => root.render(<Consumer scope={scope} field={field} />)); return host
}
async function click(host: HTMLElement, text: string) {
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === text)!.click() })
}
async function edit(host: HTMLElement, value: string) {
  const input = host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function stored() { return (await db.worldviews.toArray())[0] }

describe.each(['worldOrigin', 'races', 'divineNames'] as const)('051 explicitly opted-in %s reading', field => {
  it('renders safely without claiming a Natural save receipt and keeps the exact source until a real domain save', async () => {
    const { scope } = await seedCurrentWorkspace()
    await useWorldviewStore.getState().loadAll(scope)
    await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldOrigin: source, races: source,
      divineDesign: { hasDivinity: true, divineNames: source, divineRules: '保持其他字段' } }, scope)
    const before = await stored(), host = await mount(scope, field)
    expect(host.querySelector('h1')?.textContent).toBe('原始🌊')
    expect(host.querySelector('[data-local-save-status]')).toBeNull()
    await click(host, '查看源码'); expect(host.querySelector('[data-markdown-source]')?.textContent).toBe(source)
    await click(host, '返回阅读'); expect(await stored()).toEqual(before)
    await click(host, '编辑源码'); await edit(host, '# 作者修改\n\n仍是第七年。  ')
    await act(async () => { await flushPendingEditsV1() })
    expect(host.querySelector('textarea')).toBeNull(); expect(host.querySelector('h1')?.textContent).toBe('作者修改')
    const saved = await stored()
    expect(field === 'divineNames' ? saved.divineDesign?.divineNames : saved[field]).toBe('# 作者修改\n\n仍是第七年。  ')
    expect(saved.divineDesign?.divineRules).toBe('保持其他字段')
  })
})

it('retains source editing after an actual transaction failure and returns to reading only after retry commits', async () => {
  const { scope } = await seedCurrentWorkspace()
  await useWorldviewStore.getState().loadAll(scope)
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, races: source }, scope)
  const host = await mount(scope, 'races'), before = await stored()
  await click(host, '编辑源码'); await edit(host, '# 未提交的草稿')
  const reject = () => { throw Error('isolated-storage-failure') }
  db.worldviews.hook('updating', reject)
  try { await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('isolated-storage-failure') }) }
  finally { db.worldviews.hook('updating').unsubscribe(reject) }
  expect(host.querySelector('textarea')?.value).toBe('# 未提交的草稿'); expect(await stored()).toEqual(before)
  await act(async () => { await flushPendingEditsV1() })
  expect(host.querySelector('h1')?.textContent).toBe('未提交的草稿'); expect((await stored()).races).toBe('# 未提交的草稿')
})

it('rolls back initial admission when the exact-source write fails and retries without a partial or duplicate row', async () => {
  const { scope } = await seedCurrentWorkspace()
  await useWorldviewStore.getState().loadAll(scope)
  const reject = () => { throw Error('initial-exact-write-failure') }
  db.worldviews.hook('updating', reject)
  try {
    await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldOrigin: source }, scope)).rejects.toThrow('initial-exact-write-failure')
  } finally { db.worldviews.hook('updating').unsubscribe(reject) }
  expect(await db.worldviews.count()).toBe(0)
  expect(useWorldviewStore.getState().worldview).toBeNull()
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldOrigin: source }, scope)
  expect(await db.worldviews.count()).toBe(1); expect((await stored()).worldOrigin).toBe(source)
})
