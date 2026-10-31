import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { adopt } from '../../src/lib/registry/adopt'
import { useForeshadowStore } from '../../src/stores/foreshadow'
import { useDetailedOutlineStore } from '../../src/stores/detailed-outline'
import ForeshadowPanel from '../../src/components/foreshadow/ForeshadowPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import type { Project } from '../../src/lib/types'

const nativeDelete = useForeshadowStore.getState().deleteForeshadow
let host: HTMLDivElement
let root: Root
let unmounted = false
let holdDelivery = false
const observed: Promise<void>[] = []
const errors: unknown[] = []

interface HeldDeletion {
  id: number
  settled: boolean
  release: () => void
  promise: Promise<void>
  error: unknown
}
const held: HeldDeletion[] = []
const deleteFailures = new Map<number, string>()
const deleteFailureCounts = new Map<number, number>()

const snapshot = async () => Object.fromEntries(
  await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])),
)

async function waitFor(assertion: () => void) {
  await act(async () => {
    await vi.waitFor(assertion, { timeout: 2000, interval: 10 })
  })
}

// This shared observer always calls the native store. The original two tests
// receive its exact promise; ordering tests delay only its real settled outcome.
function observeDeletion(id: number): Promise<void> {
  const original = nativeDelete(id)
  if (!holdDelivery) {
    observed.push(original)
    void original.catch(error => errors.push(error))
    return original
  }
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const operation: HeldDeletion = {
    id, settled: false, release, promise: Promise.resolve(), error: undefined,
  }
  held.push(operation)
  operation.promise = original.then(
    async value => { operation.settled = true; await gate; return value },
    async error => {
      operation.settled = true
      operation.error = error
      await gate
      throw error
    },
  )
  observed.push(operation.promise)
  void operation.promise.catch(error => errors.push(error))
  return operation.promise
}

function failActualDeletion(key: unknown) {
  if (typeof key !== 'number') return
  const prefix = deleteFailures.get(key)
  if (!prefix) return
  const count = (deleteFailureCounts.get(key) ?? 0) + 1
  deleteFailureCounts.set(key, count)
  throw Error(`${prefix} native failure ${count}`)
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await db.delete()
  await db.open()
  observed.length = 0
  errors.length = 0
  held.length = 0
  deleteFailures.clear()
  deleteFailureCounts.clear()
  holdDelivery = false
  unmounted = false
  useForeshadowStore.setState({
    foreshadows: [], loading: false, deleteForeshadow: observeDeletion,
  })
  useDetailedOutlineStore.setState({
    detailedOutlines: [], loadedScope: null, loading: false, loadError: null,
  })
  db.foreshadows.hook('deleting', failActualDeletion)
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Review forbids actual network') }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    held.forEach(operation => operation.release())
    await Promise.allSettled(observed)
    if (!unmounted) root.unmount()
  })
  db.foreshadows.hook('deleting').unsubscribe(failActualDeletion)
  host.remove()
  useForeshadowStore.setState({ deleteForeshadow: nativeDelete })
  expect(fetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
  await db.delete()
})

async function fixture(options: {
  workspaceName?: string; nameA?: string; descriptionA?: string
} = {}) {
  const f = await createWorkspace({
    name: options.workspaceName ?? '048实际伏笔反馈', description: '',
    genres: ['fantasy'], status: 'drafting', targetWordCount: 1000,
  }, {
    kind: 'novel', novelProfile: 'long', importedNovelText: '作者正文完整保留。',
  })
  const nameA = options.nameA ?? '独审实际选择的伏笔'
  const descriptionA = options.descriptionA ?? '作者最后保存的完整伏笔描述'
  const result = await adopt({
    projectId: f.scope.projectId, scope: f.scope, target: 'foreshadows', mode: 'add',
    data: { name: nameA, description: descriptionA, type: 'chekhov', status: 'planned' },
  })
  expect(result.written).toHaveLength(1)
  const id = result.written[0].id
  const chapter = (await db.chapters.where('projectId').equals(f.scope.projectId).first())!
  const d = await useDetailedOutlineStore.getState().getOrCreate(f.scope, chapter.outlineNodeId)
  await useDetailedOutlineStore.getState().save(d.id!, { foreshadowIds: [id] }, f.scope)
  const project = (await db.projects.get(f.scope.projectId))!
  return { f, id, d, project, nameA, descriptionA }
}

async function renderProject(project: Project) {
  await act(async () => {
    root.render(createElement(ToastProvider, null,
      createElement(DialogProvider, null, createElement(ForeshadowPanel, { project }))))
  })
}

// Original two cases retain their native actions, 2s wait, DB comparisons,
// selected-item and complete-description assertions.
for (const damaged of [false, true])
  it(`actual ForeshadowPanel handles native deletion damaged=${damaged}`, async () => {
    const { id, d, project } = await fixture()
    if (damaged) {
      await db.table<Record<string, unknown>, number>('detailedOutlines').update(
        d.id!, { foreshadowIds: '{broken author reference evidence' },
      )
    }
    await renderProject(project)
        await waitFor(() => { expect(host.textContent).toContain('独审实际选择的伏笔'); });
        const card = [...host.querySelectorAll('div.group')].find(e => e.textContent?.includes('独审实际选择的伏笔'));
        expect(card).toBeDefined();
        await act(async () => { (card as HTMLElement).click(); });
        await waitFor(() => { expect([...host.querySelectorAll('input')].some(e => e.value === '独审实际选择的伏笔')).toBe(true); });
        const desc = [...host.querySelectorAll('textarea')].find(e => e.value === '作者最后保存的完整伏笔描述');
        expect(desc).toBeDefined();
        const remove = [...host.querySelectorAll('button')].find(e => e.querySelector('svg.lucide-trash2,svg.lucide-trash-2'));
        expect(remove).toBeDefined();
        const before = await snapshot();
        await act(async () => { remove!.click(); await Promise.allSettled(observed); });
        expect(observed).toHaveLength(1);
        const after = await snapshot(), visible = host.textContent ?? '', selectedStill = [...host.querySelectorAll('input')].some(e => e.value === '独审实际选择的伏笔');
        if (damaged) {
            expect(errors).toHaveLength(1);
            expect(after).toEqual(before);
            expect(await db.foreshadows.get(id)).toBeDefined();
            expect(visible).toContain('删除已取消');
            expect(selectedStill).toBe(true);
            expect([...host.querySelectorAll('textarea')].some(e => e.value === '作者最后保存的完整伏笔描述')).toBe(true);
        }
        else {
            expect(errors).toHaveLength(0);
            expect(await db.foreshadows.get(id)).toBeUndefined();
            expect((await db.detailedOutlines.get(d.id!))?.foreshadowIds).toEqual([]);
            expect(selectedStill).toBe(false);
        }
    });


async function pairFixture(label: string) {
  const base = await fixture({
    workspaceName: label, nameA: `${label}-A`, descriptionA: `${label}-A完整原文`,
  })
  const nameB = `${label}-B`
  const result = await adopt({
    projectId: base.f.scope.projectId, scope: base.f.scope,
    target: 'foreshadows', mode: 'add',
    data: { name: nameB, description: `${nameB}完整原文`, type: 'chekhov', status: 'planned' },
  })
  expect(result.written).toHaveLength(1)
  const idB = result.written[0].id
  await useDetailedOutlineStore.getState().save(
    base.d.id!, { foreshadowIds: [base.id, idB] }, base.f.scope,
  )
  deleteFailures.set(base.id, base.nameA)
  deleteFailures.set(idB, nameB)
  return { ...base, idB, nameB }
}

async function selectItem(name: string) {
  if ([...host.querySelectorAll('input')].some(input => input.value === name)) return
  const button = [...host.querySelectorAll('button')]
    .find(item => item.querySelector('div.font-medium')?.textContent === name)
  const card = [...host.querySelectorAll('div.group')]
    .find(item => item.querySelector('span.truncate')?.textContent?.trim() === name)
  const target = button ?? card
  expect(target).toBeDefined()
  await act(async () => { (target as HTMLElement).click() })
  await waitFor(() => {
    expect([...host.querySelectorAll('input')].some(input => input.value === name)).toBe(true)
  })
}

function deleteButton(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="删除伏笔"]')
  expect(button).not.toBeNull()
  return button!
}

async function clickDelete() {
  await act(async () => { deleteButton().click() })
  await waitFor(() => { expect(held[held.length - 1]?.settled).toBe(true) })
}

async function releaseResult(index: number) {
  await act(async () => {
    held[index].release()
    await Promise.allSettled([held[index].promise])
  })
}

it('keeps the real B selection and pending state when original A rejects late', async () => {
  holdDelivery = true
  const f = await pairFixture('048-A-B')
  await renderProject(f.project)
  await waitFor(() => { expect(host.textContent).toContain(f.nameA) })
  await selectItem(f.nameA)
  const before = await snapshot()
  await clickDelete()
  await selectItem(f.nameB)
  await clickDelete()
  expect(held).toHaveLength(2)
  expect(deleteButton().disabled).toBe(true)
  await releaseResult(0)
  expect(deleteButton().disabled).toBe(true)
  expect(host.textContent).not.toContain(`${f.nameA} native failure`)
  expect([...host.querySelectorAll('input')].some(input => input.value === f.nameB)).toBe(true)
  await releaseResult(1)
  expect(deleteButton().disabled).toBe(false)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(`${f.nameB} native failure`)
  expect(await snapshot()).toEqual(before)
})

it('blocks same-turn duplicate and disabled clicks on the current pending item', async () => {
  holdDelivery = true
  const f = await pairFixture('048-duplicate')
  await renderProject(f.project)
  await waitFor(() => { expect(host.textContent).toContain(f.nameA) })
  await selectItem(f.nameA)
  const before = await snapshot()
  await act(async () => { const button = deleteButton(); button.click(); button.click() })
  await waitFor(() => { expect(held[0]?.settled).toBe(true) })
  expect(held).toHaveLength(1)
  expect(deleteButton().disabled).toBe(true)
  await act(async () => { deleteButton().click() })
  expect(held).toHaveLength(1)
  await releaseResult(0)
  expect(deleteButton().disabled).toBe(false)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('native failure')
  expect(await snapshot()).toEqual(before)
})

it('ignores the original native rejection after actual unmount', async () => {
  holdDelivery = true
  const f = await pairFixture('048-unmount')
  await renderProject(f.project)
  await waitFor(() => { expect(host.textContent).toContain(f.nameA) })
  await selectItem(f.nameA)
  const before = await snapshot()
  await clickDelete()
  await act(async () => { root.unmount(); unmounted = true })
  expect(host.innerHTML).toBe('')
  await releaseResult(0)
  expect(host.innerHTML).toBe('')
  expect(await snapshot()).toEqual(before)
})

it('keeps a new real owner command isolated from the previous owner rejection', async () => {
  holdDelivery = true
  const a = await pairFixture('048-owner-A')
  const b = await pairFixture('048-owner-B')
  await renderProject(a.project)
  await waitFor(() => { expect(host.textContent).toContain(a.nameA) })
  await selectItem(a.nameA)
  const before = await snapshot()
  await clickDelete()
  await renderProject(b.project)
  await waitFor(() => { expect(host.textContent).toContain(b.nameA) })
  await selectItem(b.nameA)
  await clickDelete()
  expect(deleteButton().disabled).toBe(true)
  await releaseResult(0)
  expect(deleteButton().disabled).toBe(true)
  expect(host.textContent).not.toContain(`${a.nameA} native failure`)
  expect([...host.querySelectorAll('input')].some(input => input.value === b.nameA)).toBe(true)
  await releaseResult(1)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(`${b.nameA} native failure`)
  expect(await snapshot()).toEqual(before)
})

it('assigns transient UI to the latest explicit A request after A to B to A', async () => {
  holdDelivery = true
  const f = await pairFixture('048-return-A')
  await renderProject(f.project)
  await waitFor(() => { expect(host.textContent).toContain(f.nameA) })
  await selectItem(f.nameA)
  const before = await snapshot()
  await clickDelete()
  await selectItem(f.nameB)
  await clickDelete()
  await selectItem(f.nameA)
  await clickDelete()
  expect(held).toHaveLength(3)
  expect(deleteButton().disabled).toBe(true)
  await releaseResult(0)
  expect(deleteButton().disabled).toBe(true)
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(await snapshot()).toEqual(before)
  await releaseResult(2)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(`${f.nameA} native failure 2`)
  await releaseResult(1)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(`${f.nameA} native failure 2`)
})
