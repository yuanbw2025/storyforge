import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InlineTextarea } from '../../src/components/shared/InlineEdit'
import { CTextarea } from '../../src/components/shared/CompositionInput'
import { INPUT_AREA_STORAGE_KEY_V1, loadInputAreaBoxV1 } from '../../src/lib/input-area-layout'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: { root: ReturnType<typeof createRoot>; host: HTMLDivElement }[] = []
afterEach(async () => {
  for (const ui of mounted.splice(0)) { await act(async () => ui.root.unmount()); ui.host.remove() }
  resetPendingEditCoordinatorForTestsV1(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
async function mount(element: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  await act(async () => root.render(element))
  return { host, root }
}
async function admitBounds(host: HTMLElement, width = 600) {
  const frame = host.querySelector<HTMLElement>('[data-input-area-layout]')!
  Object.defineProperty(frame, 'clientWidth', { configurable: true, value: width })
  frame.getBoundingClientRect = () => new DOMRect(0, 0, width, 200)
  await act(async () => window.dispatchEvent(new Event('resize')))
}
async function edit(textarea: HTMLTextAreaElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === text)!

describe('047 default-off shared seams', () => {
  it('leaves unadmitted CTextarea DOM, ref, props, blur, input and wheel behavior unchanged without layout persistence', async () => {
    const ref = createRef<HTMLTextAreaElement>(), change = vi.fn(), blur = vi.fn(), wheel = vi.fn(), capture = vi.fn()
    const get = vi.spyOn(Storage.prototype, 'getItem'), set = vi.spyOn(Storage.prototype, 'setItem')
    const ui = await mount(<CTextarea ref={ref} value="共享 world-engine/story-core/角色参考路径" onChange={change} onBlur={blur} onWheel={wheel} onCompositionStartCapture={capture} className="original-resize-y" />)
    const textarea = ui.host.firstElementChild as HTMLTextAreaElement
    expect(textarea.tagName).toBe('TEXTAREA'); expect(ref.current).toBe(textarea)
    expect(textarea.className).toBe('original-resize-y'); expect(ui.host.querySelector('[data-input-area-layout]')).toBeNull()
    await edit(textarea, '输入')
    await act(async () => { textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); textarea.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 10 })); textarea.focus(); textarea.blur() })
    expect(change).toHaveBeenCalled(); expect(blur).toHaveBeenCalledOnce(); expect(wheel).toHaveBeenCalledOnce(); expect(capture).toHaveBeenCalledOnce()
    expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled()
  })
  it('leaves non-opted-in InlineTextarea on its original blur save and autoheight path', async () => {
    const save = vi.fn().mockResolvedValue(undefined), ui = await mount(<InlineTextarea value="原稿" onChange={save} />)
    await act(async () => (ui.host.firstElementChild as HTMLElement).click())
    expect(ui.host.querySelector('[data-input-area-layout]')).toBeNull()
    const textarea = ui.host.querySelector('textarea')!
    await edit(textarea, '新稿')
    await act(async () => textarea.blur())
    expect(save).toHaveBeenCalledExactlyOnceWith('新稿')
  })
  it('keeps dirty InlineTextarea focused through layout controls, then saves exactly once on true external leave', async () => {
    const save = vi.fn().mockResolvedValue(undefined), submit = vi.fn(event => event.preventDefault())
    const ui = await mount(<form onSubmit={submit}><InlineTextarea value="原稿" onChange={save} inputAreaLayout={{ enabled: true, preferenceKey: 'story.theme/current' }} /><button type="button" data-outside>外部</button></form>)
    await act(async () => (ui.host.querySelector('form')!.firstElementChild as HTMLElement).click())
    await admitBounds(ui.host)
    const textarea = ui.host.querySelector('textarea')!, handle = ui.host.querySelector<HTMLButtonElement>('[aria-label="调整输入区大小"]')!, reset = button(ui.host, '恢复自适应')
    await edit(textarea, '作者草稿')
    textarea.setSelectionRange(1, 3)
    await act(async () => { handle.focus(); handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); reset.focus() })
    expect(save).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled()
    expect(ui.host.querySelector('textarea')).toBe(textarea)
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([1, 3])
    for (const control of ui.host.querySelectorAll('[data-input-area-layout] button')) expect(control.getAttribute('type')).toBe('button')
    const height = textarea.style.height
    await edit(textarea, '作者草稿\n'.repeat(20))
    expect(textarea.style.height).toBe(height)
    await act(async () => reset.click())
    expect(save).not.toHaveBeenCalled(); expect(textarea.value).toBe('作者草稿\n'.repeat(20))
    await act(async () => ui.host.querySelector<HTMLButtonElement>('[data-outside]')!.focus())
    expect(save).toHaveBeenCalledExactlyOnceWith('作者草稿\n'.repeat(20))
  })
  it('keeps readonly/busy props and same actual textarea ref/capture/scroll through a label-wrapped candidate and internal keyboard blur routing', async () => {
    const ref = createRef<HTMLTextAreaElement>(), change = vi.fn(), blur = vi.fn(), captured = vi.fn(), scroll = vi.fn()
    const ui = await mount(<><label>原文<CTextarea ref={ref} value="原文😀" readOnly onChange={change} onBlur={blur} onCompositionStartCapture={captured} onScroll={scroll} inputAreaLayout={{ enabled: true, preferenceKey: 'world.origin/original' }} /></label><button type="button" data-outside>外部</button></>)
    await admitBounds(ui.host)
    const textarea = ref.current!, handle = ui.host.querySelector<HTMLButtonElement>('[aria-label="调整输入区大小"]')!
    await act(async () => { textarea.focus(); handle.focus(); handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(blur).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled()
    expect(textarea.readOnly).toBe(true); expect(ref.current).toBe(textarea)
    await act(async () => textarea.dispatchEvent(new Event('scroll', { bubbles: true })))
    expect(scroll).toHaveBeenCalledOnce()
    await act(async () => ui.host.querySelector<HTMLButtonElement>('[data-outside]')!.focus())
    expect(blur).toHaveBeenCalledOnce()
    expect(blur.mock.calls[0][0].currentTarget).toBe(textarea)
    expect(loadInputAreaBoxV1('world.origin/original')).not.toBeNull()
    await act(async () => { textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); handle.click() })
    expect(captured).toHaveBeenCalledOnce(); expect(handle.disabled).toBe(true)
    expect(change).not.toHaveBeenCalled()
  })
  it('keeps failed saves and composition drafts on the original save path; layout does not retry or flush unfinished input', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('隔离失败')).mockResolvedValue(undefined)
    const ui = await mount(<InlineTextarea value="原稿" onChange={save} inputAreaLayout={{ enabled: true }} />)
    await act(async () => (ui.host.firstElementChild as HTMLElement).click())
    await admitBounds(ui.host)
    const textarea = ui.host.querySelector('textarea')!
    await edit(textarea, '保留草稿')
    await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('隔离失败') })
    const handle = ui.host.querySelector<HTMLButtonElement>('[aria-label="调整输入区大小"]')!
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(save).toHaveBeenCalledTimes(1); expect(ui.host.querySelector('textarea')).toBe(textarea)
    await act(async () => textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await edit(textarea, '中文组合草稿')
    await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('输入法') })
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
    await act(async () => flushPendingEditsV1())
    expect(save).toHaveBeenLastCalledWith('中文组合草稿')
    expect(localStorage.getItem(INPUT_AREA_STORAGE_KEY_V1)).toBeNull()
  })
  it('retains disabled and readonly permissions when resetting an explicitly opted-in candidate', async () => {
    const change = vi.fn(), ref = createRef<HTMLTextAreaElement>()
    const ui = await mount(<CTextarea ref={ref} value="候选" disabled readOnly onChange={change} inputAreaLayout={{ enabled: true, preferenceKey: 'world.origin/candidate' }} />)
    await admitBounds(ui.host)
    const textarea = ref.current!, handle = ui.host.querySelector<HTMLButtonElement>('[aria-label="调整输入区大小"]')!
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    await act(async () => button(ui.host, '恢复自适应').click())
    expect(ref.current).toBe(textarea); expect(textarea.disabled).toBe(true); expect(textarea.readOnly).toBe(true)
    expect(change).not.toHaveBeenCalled()
  })
  it('saves once when null-related external blur and window leave report the same dirty field', async () => {
    const save = vi.fn().mockResolvedValue(undefined), ui = await mount(<InlineTextarea value="原稿" onChange={save} inputAreaLayout={{ enabled: true }} />)
    await act(async () => (ui.host.firstElementChild as HTMLElement).click())
    await admitBounds(ui.host)
    const textarea = ui.host.querySelector('textarea')!
    await edit(textarea, '外离前的草稿')
    await act(async () => {
      textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
      window.dispatchEvent(new Event('blur'))
    })
    expect(save).toHaveBeenCalledExactlyOnceWith('外离前的草稿')
  })
  it('saves on true leave after a window return completes a composition draft', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const ui = await mount(<><InlineTextarea value="原稿" onChange={save} inputAreaLayout={{ enabled: true }} /><button data-outside>外部</button></>)
    await act(async () => (ui.host.firstElementChild as HTMLElement).click())
    await admitBounds(ui.host)
    const textarea = ui.host.querySelector('textarea')!
    await act(async () => textarea.focus())
    await act(async () => textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await edit(textarea, '窗口返回后完成的组合草稿')
    await act(async () => window.dispatchEvent(new Event('blur')))
    expect(save).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(textarea)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    })
    expect(save).not.toHaveBeenCalled()
    await act(async () => ui.host.querySelector<HTMLButtonElement>('[data-outside]')!.focus())
    expect(save).toHaveBeenCalledExactlyOnceWith('窗口返回后完成的组合草稿')
  })
  it('persists only finalized pointer actions, cancels/lost-capture revert and unmount removes pending writes/listeners', async () => {
    // Happy DOM binds Storage methods on first access; a later prototype spy
    // misses that cached bound method. Count the actual storage boundary here.
    const actualStorage = localStorage, set = vi.fn((key: string, value: string) => actualStorage.setItem(key, value))
    vi.stubGlobal('localStorage', { getItem: (key: string) => actualStorage.getItem(key), setItem: set, removeItem: (key: string) => actualStorage.removeItem(key), clear: () => actualStorage.clear() })
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const ui = await mount(<CTextarea value="候选" inputAreaLayout={{ enabled: true, preferenceKey: 'world.origin/candidate' }} />)
    await admitBounds(ui.host)
    const handle = ui.host.querySelector<HTMLButtonElement>('[aria-label="调整输入区大小"]')!, textarea = ui.host.querySelector('textarea')!
    const pointer = async (target: EventTarget, type: string, x: number, y: number) => act(async () => target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, clientX: x, clientY: y })))
    await pointer(handle, 'pointerdown', 600, 120)
    await pointer(window, 'pointermove', 400, 200)
    expect(set).not.toHaveBeenCalled(); expect(textarea.style.height).toBe('200px')
    await pointer(window, 'pointercancel', 400, 200)
    expect(set).not.toHaveBeenCalled(); expect(loadInputAreaBoxV1('world.origin/candidate')).toBeNull()
    await pointer(handle, 'pointerdown', 600, 120); await pointer(window, 'pointermove', 400, 200); await pointer(handle, 'lostpointercapture', 400, 200)
    expect(set).not.toHaveBeenCalled()
    await pointer(handle, 'pointerdown', 600, 120); await pointer(window, 'pointermove', 400, 200)
    await act(async () => window.dispatchEvent(new Event('blur')))
    await pointer(window, 'pointermove', 300, 300); await pointer(window, 'pointerup', 300, 300)
    expect(set).not.toHaveBeenCalled()
    await pointer(handle, 'pointerdown', 600, 120); await pointer(window, 'pointermove', 420, 240); await pointer(window, 'pointerup', 420, 240)
    expect(set).toHaveBeenCalledOnce(); expect(loadInputAreaBoxV1('world.origin/candidate')).toEqual({ width: 420, height: 240 })
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    await pointer(handle, 'pointerdown', 420, 240); await pointer(window, 'pointermove', 400, 250)
    await act(async () => ui.root.unmount())
    mounted.splice(mounted.findIndex(item => item.root === ui.root), 1); ui.host.remove()
    await pointer(window, 'pointerup', 400, 250)
    await new Promise(resolve => setTimeout(resolve, 270))
    expect(set).toHaveBeenCalledOnce()
    for (const event of ['pointermove', 'pointerup', 'pointercancel']) expect(removeListener.mock.calls.some(call => call[0] === event)).toBe(true)
  })
})
