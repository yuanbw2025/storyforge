import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useWorldviewStore } from '../../src/stores/worldview'
import { useReferenceStore } from '../../src/stores/reference'
import { useWorldGroupStore } from '../../src/stores/world-group'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { addCurrentWorkFixtureV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import StoryCorePanel from '../../src/components/worldview/StoryCorePanel'
import PowerSystemDetails from '../../src/components/worldview/PowerSystemDetails'
import WorldviewNaturalPanel from '../../src/components/worldview/WorldviewNaturalPanel'
import ReferencePanel from '../../src/components/project/ReferencePanel'

vi.mock('../../src/components/shared/PromptRunPanel', () => ({ default: () => null }))
vi.mock('../../src/components/shared/Dialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }))
vi.mock('../../src/components/shared/Toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../src/components/agent/useMasterCopilot', () => ({ useMasterCopilot: () => ({ pendingCandidates: [], busy: false, loading: false, readVisibleCandidateDraft: () => undefined }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
const raw = '  # 作者原文\r\n\r\n**事实**：每七年开放一次。\r\n\r\n```text\r\n|-- 保留  \r\n```\r\n  '
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  useWorldGroupStore.setState({ groups: [], activeGroupId: null })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model or external requests') }))
})
afterEach(async () => {
  for (const ui of mounted.splice(0)) { await act(async () => ui.root.unmount()); ui.host.remove() }
  expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resetPendingEditCoordinatorForTestsV1(); await db.delete()
})
async function mount(element: React.ReactElement) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  mounted.push({ host, root }); await act(async () => root.render(element)); return host
}
async function settle(check: () => boolean) {
  for (let i = 0; i < 50; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); if (check()) return }
  expect(check()).toBe(true)
}
async function click(host: HTMLElement, name: string) {
  const button = [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === name)!
  expect(button).toBeTruthy(); await act(async () => button.click())
}
async function edit(host: HTMLElement, text: string) {
  const area = host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('preserves exact Markdown on first StoryCore admission and updates only the selected Work field', async () => {
  const { scope } = await seedCurrentWorkspace(); await useWorldviewStore.getState().loadAll(scope)
  await useWorldviewStore.getState().saveStoryCore({ projectId: scope.projectId, logline: raw, theme: '原有主题' }, scope)
  const first = (await db.storyCores.toArray())[0]; expect(first.logline).toBe(raw)
  await useWorldviewStore.getState().saveStoryCore({ projectId: scope.projectId, logline: '# 新稿\n\n仍是七年。  ' }, scope)
  const saved = (await db.storyCores.toArray())[0]
  expect(saved.id).toBe(first.id); expect(saved.theme).toBe('原有主题'); expect(saved.logline).toBe('# 新稿\n\n仍是七年。  ')
})
it('rolls back first StoryCore admission when exact-source persistence fails and retries without a partial row', async () => {
  const { scope } = await seedCurrentWorkspace(); await useWorldviewStore.getState().loadAll(scope)
  const reject = () => { throw Error('story-source-write-failure') }; db.storyCores.hook('updating', reject)
  try { await expect(useWorldviewStore.getState().saveStoryCore({ projectId: scope.projectId, logline: raw }, scope)).rejects.toThrow('story-source-write-failure') }
  finally { db.storyCores.hook('updating').unsubscribe(reject) }
  expect(await db.storyCores.count()).toBe(0); expect(useWorldviewStore.getState().storyCore).toBeNull()
  await useWorldviewStore.getState().saveStoryCore({ projectId: scope.projectId, logline: raw }, scope)
  expect(await db.storyCores.count()).toBe(1); expect((await db.storyCores.toArray())[0].logline).toBe(raw)
})
it('renders the actual StoryCore panel without a read-time write and saves edited source before returning to reading', async () => {
  const { project, scope } = await seedCurrentWorkspace(); await useWorldviewStore.getState().loadAll(scope)
  await useWorldviewStore.getState().saveStoryCore({ projectId: scope.projectId, logline: raw }, scope)
  const before = await db.storyCores.toArray(), host = await mount(<StoryCorePanel project={project} />)
  await settle(() => host.querySelector('h1')?.textContent === '作者原文')
  await click(host, '查看源码'); expect(host.querySelector('[data-markdown-source]')?.textContent).toBe(raw)
  expect(await db.storyCores.toArray()).toEqual(before)
  await click(host, '返回阅读'); await click(host, '编辑源码'); await edit(host, '# 已改\n\n仍是七年。  ')
  await act(async () => { await flushPendingEditsV1() })
  expect(host.querySelector('h1')?.textContent).toBe('已改'); expect((await db.storyCores.toArray())[0].logline).toBe('# 已改\n\n仍是七年。  ')
})
it('reads all three PowerSystem descriptions while the name keeps its literal input behavior', async () => {
  const { project, scope } = await seedCurrentWorkspace(); await useWorldviewStore.getState().loadAll(scope)
  await useWorldviewStore.getState().savePowerSystem({ projectId: scope.projectId, name: '# 只是名称', description: raw, levels: raw, rules: raw }, scope)
  const before = await db.powerSystems.toArray(), host = await mount(<PowerSystemDetails project={project} />)
  expect(host.querySelectorAll('[data-markdown-read-view]')).toHaveLength(3)
  expect(host.querySelectorAll('h1')).toHaveLength(3); expect(host.textContent).toContain('# 只是名称')
  expect(await db.powerSystems.toArray()).toEqual(before)
})
it('reads nested NaturalResources and preserves unedited leaves during the existing domain save', async () => {
  const { project, scope } = await seedCurrentWorkspace(); await useWorldviewStore.getState().loadAll(scope)
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, naturalResources: { herbs: raw, minerals: '未修改的矿石' } }, scope)
  const host = await mount(<WorldviewNaturalPanel project={project} />)
  await settle(() => [...host.querySelectorAll('button')].some(button => button.textContent?.includes('自然资源')))
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent?.includes('自然资源'))!.click())
  await settle(() => host.querySelector('h1')?.textContent === '作者原文')
  await click(host, '编辑源码'); await edit(host, '# 灵草\n\n每七年开放一次。  ')
  await act(async () => { await flushPendingEditsV1() })
  const saved = (await db.worldviews.toArray())[0].naturalResources!
  expect(saved.herbs).toBe('# 灵草\n\n每七年开放一次。  '); expect(saved.minerals).toBe('未修改的矿石')
})
it('the actual ReferencePanel waits for its writer, retains a failed edit, and returns to reading only after retry', async () => {
  const { project, scope } = await seedCurrentWorkspace()
  const id = await useReferenceStore.getState().addReference({ projectId: scope.projectId, title: '# 字面书名', author: '', type: 'style', note: raw, url: '' }, scope)
  const host = await mount(<ReferencePanel project={project} initialReferenceId={id} />)
  await settle(() => [...host.querySelectorAll('button')].some(button => button.textContent?.trim() === '基本信息'))
  await click(host, '基本信息')
  await settle(() => host.querySelector('h1')?.textContent === '作者原文')
  await click(host, '编辑源码'); await edit(host, '# 参考改稿\n\n两处重点。  ')
  const reject = () => { throw Error('reference-storage-failure') }; db.references.hook('updating', reject)
  try { await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('reference-storage-failure') }) }
  finally { db.references.hook('updating').unsubscribe(reject) }
  expect(host.querySelector('textarea')?.value).toBe('# 参考改稿\n\n两处重点。  '); expect((await db.references.get(id))?.note).toBe(raw)
  await act(async () => { await flushPendingEditsV1() })
  expect(host.querySelector('h1')?.textContent).toBe('参考改稿'); expect((await db.references.get(id))?.note).toBe('# 参考改稿\n\n两处重点。  ')
  expect((await db.references.get(id))?.title).toBe('# 字面书名')
})
it('rejects missing references and a different active Work instead of acknowledging an unwritten edit', async () => {
  const { scope } = await seedCurrentWorkspace()
  const id = await useReferenceStore.getState().addReference({ projectId: scope.projectId, title: '原参考', author: '', type: 'style', note: raw, url: '' }, scope)
  const work = await addCurrentWorkFixtureV1({ projectId: scope.projectId, worldId: scope.worldId, create: { title: '其他作品' } })
  await db.projects.update(scope.projectId, { activeWorkId: work.id })
  await expect(useReferenceStore.getState().updateReference(id, { note: '越界改稿' })).rejects.toThrow('当前作品')
  expect((await db.references.get(id))?.note).toBe(raw)
  await db.references.delete(id)
  await expect(useReferenceStore.getState().updateReference(id, { note: '不存在的改稿' })).rejects.toThrow('已删除')
})
