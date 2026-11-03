import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { Chapter, Character, OutlineNode, WorkspaceScope } from '../../src/lib/types'
import * as rename from '../../src/lib/editor/entity-rename'

const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('../../src/components/shared/Toast', () => ({ useToast: () => feedback }))
vi.mock('../../src/components/shared/Dialog', () => ({ useDialog: () => ({ confirm: async () => true }) }))
import EntityRenamePanel from '../../src/components/editor/EntityRenamePanel'

let mounted: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined
let release = () => {}
afterEach(async () => {
  release()
  await act(async () => mounted?.unmount())
  host?.remove()
  vi.restoreAllMocks()
})

async function addChapter(scope: WorkspaceScope, title: string) {
  const node: OutlineNode = { projectId: scope.projectId, type: 'chapter', parentId: null, title, summary: '', order: 0, createdAt: 1, updatedAt: 1 }
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', node))
  const row: Chapter = { projectId: scope.projectId, outlineNodeId, title, content: '<p>李明走过山门。</p>', wordCount: 7, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1 }
  await db.chapters.add(stampNewRecord(scope, 'chapters', row))
}

it('a late A preview cannot replace the newer B preview after an actual Work-pointer change', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  await db.delete(); await db.open()
  const { scope } = await seedCurrentWorkspace('A 预览')
  const b = await createWorldWork(scope.projectId, { title: 'B 预览', kind: 'novel', novelProfile: 'long' })
  const row: Character = { projectId: scope.projectId, name: '李明', roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral', shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '[]', arc: '', createdAt: 1, updatedAt: 1 }
  const id = await db.characters.add(stampNewRecord(scope, 'characters', row, { owner: 'world' }))
  await addChapter(scope, 'A 独有预览章节')
  await addChapter({ ...scope, workId: b.id! }, 'B 独有预览章节')
  const original = rename.buildEntityRenamePreview
  let held = false
  vi.spyOn(rename, 'buildEntityRenamePreview').mockImplementationOnce(async (...args) => {
    const result = await original(...args)
    held = true
    await new Promise<void>(done => { release = done })
    return result
  })
  host = document.createElement('div'); document.body.append(host); mounted = createRoot(host)
  await act(async () => mounted!.render(createElement(EntityRenamePanel, { projectId: scope.projectId, onSelectOutlineNode: () => {} })))
  const selectEntity = async () => {
    await vi.waitFor(() => expect(host!.querySelector(`option[value="character:${id}"]`)).not.toBeNull())
    await act(async () => {
      const select = host!.querySelector('select')!
      select.value = `character:${id}`; select.dispatchEvent(new Event('change', { bubbles: true }))
      const input = host!.querySelector('input')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '林照')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const preview = () => Array.from(host!.querySelectorAll('button')).find(button => button.textContent?.includes('预览影响范围'))!
  await selectEntity()
  await act(async () => preview().click())
  await vi.waitFor(() => expect(held).toBe(true))
  await act(async () => { await switchActiveWork(scope.projectId, b.id!) })
  await vi.waitFor(() => expect(host!.querySelector('select')?.value).toBe(''))
  await selectEntity()
  await act(async () => preview().click())
  await vi.waitFor(() => expect(host!.textContent).toContain('B 独有预览章节'))
  await act(async () => release())
  expect(host.textContent).toContain('B 独有预览章节')
  expect(host.textContent).not.toContain('A 独有预览章节')
  expect(feedback.error).not.toHaveBeenCalled()
  expect(await db.snapshots.count()).toBe(0)
  expect((await db.characters.get(id))?.name).toBe('李明')
})
