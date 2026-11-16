import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { useInspirationWorkspaceStore as store } from '../../src/stores/inspiration-workspace'
import { useIncrementalInspiration } from '../../src/hooks/useIncrementalInspiration'
import { MAX_INSPIRATION_FRAGMENTS, parseInspirationFragments } from '../../src/lib/inspiration/workspace'
import type { Project } from '../../src/lib/types'

const model = vi.hoisted(() => ({ submit: vi.fn() }))
vi.mock('../../src/components/agent/useMasterCopilot', () => ({
  useMasterCopilot: () => ({ pendingCandidates: [], busy: false, error: null,
    stop: () => undefined, submitTargetedRequest: model.submit }),
}))
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
let root: Root | undefined, host: HTMLDivElement | undefined
let controller: ReturnType<typeof useIncrementalInspiration>
let saves: Array<ReturnType<typeof controller.addCurrentFragment>> = []
const holds: Array<{ release: () => void; done: Promise<unknown> }> = []
function Harness({ project }: { project: Project }) {
  controller = useIncrementalInspiration(project, () => undefined)
  return <><textarea aria-label="灵感输入" value={controller.inspiration} onChange={event => controller.setInspiration(event.currentTarget.value)} />
    <button disabled={!controller.inspiration.trim() || controller.inspiration.trim().length > 2000}
      onClick={() => { saves.push(controller.addCurrentFragment()) }}>加入素材库</button>
    <p role="status">{controller.fusionError}</p></>
}
async function create() {
  return (await createWorkspace({ name: '真实灵感hook隔离回归', description: '', genres: [], status: 'drafting', targetWordCount: 1000 },
    { kind: 'novel', novelProfile: 'long' })).scope
}
async function mount(projectId: number) {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('test Project missing')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root!.render(<Harness project={project} />) })
  await act(async () => { await vi.waitFor(() => expect(store.getState().loading).toBe(false)) })
}
async function holdWrites() {
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>(resolve => { entered = resolve })
  const done = db.transaction('rw', db.inspirationWorkspaces, async () => {
    await db.inspirationWorkspaces.count(); entered(); await Dexie.waitFor(gate)
  })
  const hold = { release: () => release(), done }; holds.push(hold)
  await ready; return hold
}
const button = () => host!.querySelector('button')!
beforeEach(async () => {
  await db.delete(); await db.open(); localStorage.clear(); sessionStorage.clear()
  store.setState({ scope: null, workspace: null, fragments: [], versions: [], loading: false })
  saves = []; model.submit.mockReset()
})
afterEach(async () => {
  for (const hold of holds) hold.release()
  await Promise.allSettled(holds.map(hold => hold.done)); holds.length = 0
  if (root) await act(async () => root!.unmount())
  host?.remove(); root = undefined; host = undefined
  expect(model.submit).not.toHaveBeenCalled(); db.close()
})

describe('SFQA059/060 real hook and production admission', () => {
  it('keeps both successful edited-and-saved inputs while native persistence is blocked', async () => {
    const scope = await create(); await mount(scope.projectId)
    const hold = await holdWrites()
    await Dexie.ignoreTransaction(async () => {
      act(() => controller.setInspiration('FIRST_HOOK_AUTHORED_TEXT'))
      expect(button().disabled).toBe(false); act(() => button().click())
      act(() => controller.setInspiration('SECOND_HOOK_AUTHORED_TEXT'))
      expect(button().disabled).toBe(false); act(() => button().click())
      expect(saves).toHaveLength(2)
      let results: Awaited<ReturnType<typeof controller.addCurrentFragment>>[] = []
      await act(async () => { hold.release(); await hold.done; results = await Promise.all(saves) })
      expect(results.every(Boolean)).toBe(true)
      const row = await db.inspirationWorkspaces.where('projectId').equals(scope.projectId).filter(item => item.workId === scope.workId).first()
      expect(parseInspirationFragments(row?.fragments)).toEqual(expect.arrayContaining(results))
      expect(parseInspirationFragments(row?.fragments)).toHaveLength(2)
      expect(controller.fusionError).toBe('')
      expect(controller.inspiration).toBe('SECOND_HOOK_AUTHORED_TEXT')
      expect(controller.selectedFragmentIds).toEqual(new Set(results.map(item => item!.id)))
    })
  })

  it('reports full capacity, preserves author input and never generates from the unsaved new text', async () => {
    const scope = await create(); await store.getState().load(scope)
    for (let index = 0; index < MAX_INSPIRATION_FRAGMENTS; index++) {
      await store.getState().addFragment(scope, { text: `Already retained ${index}` })
    }
    await mount(scope.projectId)
    const before = await db.inspirationWorkspaces.toArray()
    act(() => controller.setInspiration('UNSAVED_NEW_TEXT_AT_CAPACITY'))
    await act(async () => { button().click(); await saves[0] })
    expect(controller.fusionError).toMatch(/24|已满|上限/)
    expect(controller.inspiration).toBe('UNSAVED_NEW_TEXT_AT_CAPACITY')
    expect(await db.inspirationWorkspaces.toArray()).toEqual(before)
    await act(async () => { await controller.generate() })
    expect(controller.inspiration).toBe('UNSAVED_NEW_TEXT_AT_CAPACITY')
    expect(await db.inspirationWorkspaces.toArray()).toEqual(before)
    expect(model.submit).not.toHaveBeenCalled()
  })

  it('surfaces a native write failure, retains the input and permits an explicit successful retry', async () => {
    const scope = await create(); await store.getState().load(scope)
    await store.getState().addFragment(scope, { text: 'Existing source' }); await mount(scope.projectId)
    const before = await db.inspirationWorkspaces.toArray()
    const reject = () => { throw new Error('synthetic persistent write failure') }
    db.inspirationWorkspaces.hook('updating', reject)
    try {
      act(() => controller.setInspiration('INPUT_SURVIVES_FAILURE'))
      await act(async () => { button().click(); await saves[0] })
      expect(controller.fusionError).toContain('synthetic persistent write failure')
      expect(controller.inspiration).toBe('INPUT_SURVIVES_FAILURE')
      expect(await db.inspirationWorkspaces.toArray()).toEqual(before)
    } finally { db.inspirationWorkspaces.hook('updating').unsubscribe(reject) }
    await act(async () => { button().click(); await saves[1] })
    expect(controller.fusionError).toBe('')
    expect(controller.inspiration).toBe('INPUT_SURVIVES_FAILURE')
    expect(parseInspirationFragments((await db.inspirationWorkspaces.toArray())[0].fragments).map(item => item.text))
      .toEqual(['Existing source', 'INPUT_SURVIVES_FAILURE'])
  })
})
