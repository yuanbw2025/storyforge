import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LocationPanel from '../../src/components/location/LocationPanel'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { useLocationStore } from '../../src/stores/location'

let host: HTMLDivElement, root: Root
const network = vi.fn(async () => { throw new Error('SFQA047 no network or model request allowed') })

async function ready(corrupt = false) {
  const created = await createWorkspace({ name: '地点真实界面', description: '', genres: [], status: 'drafting', targetWordCount: 0 },
    { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const add = (name: string, parentId: number | null = null) => useLocationStore.getState().addLocation({
    projectId: created.scope.projectId, name, parentId, tags: '[]', description: '逐字保留的地点正文', significance: '', sortOrder: 0,
  })
  const a = await add('海港'), b = await add('码头', a), c = await add('灯塔')
  if (corrupt) await db.importantLocations.update(a, { parentId: b })
  await act(async () => root.render(<LocationPanel project={created.project} />))
  await vi.waitFor(() => expect(button('列表')).toBeDefined())
  await act(async () => button('列表')!.click())
  await vi.waitFor(() => expect(button('海港')).toBeDefined())
  await act(async () => button('海港')!.click())
  return { ...created, a, b, c }
}

function button(text: string) {
  return [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === text
    || (text === '海港' && node.textContent?.trim().startsWith('海港')))
}
function parentSelect() { return host.querySelector<HTMLSelectElement>('select')! }
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    if (element instanceof HTMLInputElement) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    else element.value = value
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
async function rows() { return db.importantLocations.toArray() }

beforeEach(async () => {
  await db.delete(); await db.open(); useLocationStore.setState({ locations: [], loading: false })
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', network); network.mockClear()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  expect(network).not.toHaveBeenCalled()
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); await db.delete()
})

describe('SFQA047 actual location editor', () => {
  it('excludes descendants and self, keeps a valid parent choice and shows the deterministic guard error without losing data', async () => {
    const f = await ready(), select = parentSelect(), before = await rows()
    const values = [...select.options].map(option => option.value)
    expect(values).not.toContain(String(f.a))
    expect(values).not.toContain(String(f.b))
    expect(values).toContain(String(f.c))
    // A forged DOM option cannot bypass the actual backend parent guard.
    const invalid = document.createElement('option'); invalid.value = String(f.b); invalid.textContent = '强制非法选项'; select.append(invalid)
    await change(select, String(f.b))
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('层级不能'))
    expect(await rows()).toEqual(before)
    expect(host.textContent).toContain('海港')
    expect(host.textContent).toContain('码头')
  })

  it('displays both real historical cycle rows and permits explicit repair while retaining their original prose', async () => {
    const f = await ready(true), before = await rows(), select = parentSelect()
    expect(host.textContent).toContain('上级关系异常')
    expect(host.textContent).toContain('海港')
    expect(host.textContent).toContain('码头')
    expect(select.value).toBe(String(f.b))
    expect([...select.options].find(option => option.value === String(f.b))!.disabled).toBe(true)
    expect(await rows()).toEqual(before)
    await change(select, '')
    await vi.waitFor(async () => expect((await db.importantLocations.get(f.a))!.parentId).toBeNull())
    await vi.waitFor(() => expect(host.textContent).not.toContain('上级关系异常'))
    for (const row of await rows()) expect(row.description).toBe('逐字保留的地点正文')
    expect((await db.importantLocations.get(f.b))!.parentId).toBe(f.a)
  })

  it('retains the existing controlled input and focus during ordinary text edits', async () => {
    const f = await ready(), input = host.querySelector<HTMLInputElement>('input')!
    input.focus(); expect(document.activeElement).toBe(input)
    await change(input, '新海港')
    await vi.waitFor(async () => expect((await db.importantLocations.get(f.a))!.name).toBe('新海港'))
    expect(host.querySelector('input')).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(useLocationStore.getState().loading).toBe(false)
  })
})
