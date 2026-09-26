import { act, createElement, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOutlineDragScroll } from '../../src/components/outline/useOutlineDragScroll'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 1
async function mount() {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  function Harness() {
    const ref = useRef<HTMLDivElement>(null)
    useOutlineDragScroll(ref)
    return createElement('div', { ref }, createElement('div', { style: { overflowY: 'auto' }, 'data-pane': true }, createElement('button', { draggable: true }, 'chapter')))
  }
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(Harness)))
  const pane = host.querySelector<HTMLElement>('[data-pane]')!
  Object.defineProperties(pane, { scrollHeight: { value: 1000 }, clientHeight: { value: 300 } })
  pane.getBoundingClientRect = () => ({ top: 100, bottom: 400, left: 0, right: 400, height: 300, width: 400, x: 0, y: 100, toJSON() {} })
  return { pane, handle: host.querySelector('button')! }
}
function event(target: Element, type: string, y = 395) {
  const evt = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(evt, { clientY: { value: y }, relatedTarget: { value: null } })
  target.dispatchEvent(evt)
}
function tick(time = 16) { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)) }
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host?.remove(); frames.clear(); vi.unstubAllGlobals() })

describe('Feedback #54: outline edge scrolling', () => {
  it('scrolls continuously at the lower edge, reverses at upper edge, stops in middle', async () => {
    const { pane, handle } = await mount()
    event(handle, 'dragstart'); event(handle, 'dragover'); tick()
    const first = pane.scrollTop
    expect(first).toBeGreaterThan(0)
    tick(32); expect(pane.scrollTop).toBeGreaterThan(first)
    event(handle, 'dragover', 105); tick(48); expect(pane.scrollTop).toBeCloseTo(first)
    event(handle, 'dragover', 250); expect(frames.size).toBe(0)
  })
  it.each(['drop', 'dragend'])('cancels scrolling on %s and ignores external drags', async end => {
    const { pane, handle } = await mount()
    event(handle, 'dragover'); expect(frames.size).toBe(0)
    event(handle, 'dragstart'); event(handle, 'dragover'); tick()
    event(handle, end); const stopped = pane.scrollTop
    tick(); event(handle, 'dragover'); tick()
    expect(pane.scrollTop).toBe(stopped); expect(frames.size).toBe(0)
  })
  it('cancels the pending frame on Escape even if native dragend is delayed', async () => {
    const { handle } = await mount()
    event(handle, 'dragstart'); event(handle, 'dragover')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(frames.size).toBe(0)
    event(handle, 'dragover'); expect(frames.size).toBe(0)
  })
  it('stops outside the pane, on blur and on unmount', async () => {
    const { handle } = await mount()
    event(handle, 'dragstart'); event(handle, 'dragover'); expect(frames.size).toBe(1)
    event(document.body, 'dragover'); expect(frames.size).toBe(0)
    event(handle, 'dragover'); window.dispatchEvent(new Event('blur')); expect(frames.size).toBe(0)
    event(handle, 'dragstart'); event(handle, 'dragover')
    await act(async () => root!.unmount()); root = undefined
    expect(frames.size).toBe(0)
  })
})
