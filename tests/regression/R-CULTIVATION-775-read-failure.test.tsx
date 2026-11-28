import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CodexEntryDetail from '../../src/components/codex/CodexEntryDetail'
import CultivationProgressPanel from '../../src/components/cultivation/CultivationProgressPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { db } from '../../src/lib/db/schema'
import { useCultivationStore } from '../../src/stores/cultivation'
import { useCodexStore } from '../../src/stores/codex'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(async () => {
  await db.delete(); await db.open()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); db.close() })
async function waitFor(check: () => void) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }); check() })
}
async function fixture() {
  const { scope, project } = await seedCurrentWorkspace('775 readonly boundary')
  await useCodexStore.getState().loadExisting(scope)
  const categoryId = await useCodexStore.getState().addCategory({ projectId: scope.projectId, domain: 'natural', parentId: null,
    name: '异兽', builtInKey: 'beast', fieldSchema: '[]', hidden: false, order: 0 })
  const id = await useCodexStore.getState().addEntry({ projectId: scope.projectId, categoryId, name: '白鹿', summary: '', description: '原文', fields: '{}', refs: '{}', tags: '[]', order: 0 })
  const category = (await db.codexCategories.get(categoryId))!, entry = (await db.codexEntries.get(id))!
  const systemId = await useCultivationStore.getState().addSystem({ projectId: scope.projectId, name: '原世界体系', description: '原文', stages: '[]' }, scope)
  const before = { entries: await db.codexEntries.toArray(), systems: await db.cultivationSystems.toArray(), progress: await db.cultivationProgress.toArray() }
  const workspace = (await db.projects.get(scope.projectId))!
  await db.projects.delete(scope.projectId)
  return { project, scope, category, entry, systemId, workspace, before }
}
async function retry() {
  const button = [...host.querySelectorAll('button')].find(row => row.textContent === '重新读取')!
  expect(button).toBeTruthy(); await act(async () => button.click())
}
it('beast link catches native ownership rejection and preserves the original entry across explicit retry', async () => {
  const f = await fixture(), save = vi.fn()
  await act(async () => root.render(createElement(CodexEntryDetail, { entry: f.entry, category: f.category, allEntries: [f.entry], allCategories: [f.category], onChange: save })))
  await waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('修炼关联读取失败'))
  expect(host.textContent).not.toContain('原世界体系')
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="异兽修炼体系"]')?.disabled).toBe(true)
  expect(save).not.toHaveBeenCalled()
  await db.projects.add(f.workspace); await retry()
  await waitFor(() => expect(host.textContent).toContain('原世界体系'))
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(await db.codexEntries.toArray()).toEqual(f.before.entries)
  expect(await db.cultivationSystems.toArray()).toEqual(f.before.systems)
  expect(save).not.toHaveBeenCalled()
})
it('progress panel catches all parallel readonly failures, gates actions and retries without generation or writes', async () => {
  const f = await fixture()
  await act(async () => root.render(createElement(DialogProvider, null, createElement(CultivationProgressPanel, { project: f.project }))))
  await waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('修炼进度读取失败'))
  expect([...host.querySelectorAll('button')].some(row => row.textContent?.includes('分析本章'))).toBe(false)
  await db.projects.add(f.workspace); await retry()
  await waitFor(() => expect(host.querySelector('select[aria-label="修炼进度来源章节"]')).not.toBeNull())
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(await db.cultivationProgress.toArray()).toEqual(f.before.progress)
  expect(await db.cultivationSystems.toArray()).toEqual(f.before.systems)
  expect(await db.codexEntries.toArray()).toEqual(f.before.entries)
  expect(await db.agentRuns.count()).toBe(0)
})
