import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InlineInput, InlineTextarea } from '../../src/components/shared/InlineEdit'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
afterEach(async () => {
  while (mounted.length) { const item = mounted.pop()!; await act(async () => item.root.unmount()); item.host.remove() }
  resetPendingEditCoordinatorForTestsV1()
})
async function mount(Component: typeof InlineInput | typeof InlineTextarea, value: string, onChange: (value: string) => Promise<void>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  const render = async (nextValue = value, nextSave = onChange) => act(async () => { root.render(<Component value={nextValue} onChange={nextSave} />) })
  await render()
  await act(async () => { [...host.querySelectorAll('div')].filter(el => el.textContent === value).at(-1)!.click() })
  const edit = async (text: string) => act(async () => {
    const input = host.querySelector('input,textarea')! as HTMLInputElement | HTMLTextAreaElement
    const proto = input.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return { host, render, edit }
}

describe.each([['single line', InlineInput], ['multiple lines', InlineTextarea]] as const)('inline author draft recovery: %s', (_name, Component) => {
  it('keeps the edited text visible after a failed save and retries the same draft', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('隔离写入失败')).mockResolvedValue(undefined)
    const ui = await mount(Component, '原始设定', save)
    await ui.edit('尚未保存的中文设定')
    await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('隔离写入失败') })
    expect((ui.host.querySelector('input,textarea') as HTMLInputElement | null)?.value).toBe('尚未保存的中文设定')
    expect(ui.host.querySelector('[role=alert]')?.textContent).toContain('隔离写入失败')
    await act(async () => { await flushPendingEditsV1() })
    expect(ui.host.querySelector('input,textarea')).toBeNull()
    expect(save.mock.calls.map(call => call[0])).toEqual(['尚未保存的中文设定', '尚未保存的中文设定'])
  })
  it('does not replace a dirty draft or its original save target with a late prop update', async () => {
    const originalTarget = vi.fn().mockResolvedValue(undefined), nextTarget = vi.fn().mockResolvedValue(undefined)
    const ui = await mount(Component, '旧来源', originalTarget)
    await ui.edit('作者正在编辑的内容')
    await ui.render('迟到的新来源', nextTarget)
    expect((ui.host.querySelector('input,textarea') as HTMLInputElement | null)?.value).toBe('作者正在编辑的内容')
    await act(async () => { await flushPendingEditsV1() })
    expect(originalTarget).toHaveBeenCalledWith('作者正在编辑的内容')
    expect(nextTarget).not.toHaveBeenCalled()
  })
  it('keeps the draft visible until one shared pending save completes', async () => {
    let finish!: () => void
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const ui = await mount(Component, '原文', save)
    await ui.edit('新文')
    await act(async () => {
      const first = flushPendingEditsV1(), second = flushPendingEditsV1()
      await Promise.resolve(); await Promise.resolve()
      expect((ui.host.querySelector('input,textarea') as HTMLInputElement)?.value).toBe('新文')
      expect(save).toHaveBeenCalledTimes(1)
      finish(); await Promise.all([first, second])
    })
    expect(ui.host.querySelector('input,textarea')).toBeNull()
  })
  it('cancels an unsaved edit with Escape without persisting it', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const ui = await mount(Component, '原文', save)
    await ui.edit('放弃的草稿')
    await act(async () => { ui.host.querySelector('input,textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await act(async () => { await flushPendingEditsV1() })
    expect(save).not.toHaveBeenCalled()
    expect(ui.host.textContent).toBe('原文')
  })
  it('blocks saving unfinished IME text and saves it after composition ends', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const ui = await mount(Component, '原文', save)
    await act(async () => { ui.host.querySelector('input,textarea')!.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })) })
    await ui.edit('中文输入')
    await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('输入法') })
    expect(save).not.toHaveBeenCalled()
    await act(async () => { ui.host.querySelector('input,textarea')!.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })) })
    await act(async () => { await flushPendingEditsV1() })
    expect(save).toHaveBeenCalledWith('中文输入')
  })

  it('preserves a dirty draft when a corrupt read arrives and blocks an unintended overwrite', async () => {
    const original = vi.fn().mockResolvedValue(undefined), late = vi.fn().mockResolvedValue(undefined)
    const ui = await mount(Component, '旧来源', original)
    await ui.edit('必须保留的未保存输入')
    await ui.render({ broken: '迟到坏数据' } as unknown as string, late)
    await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('格式异常') })
    expect(ui.host.querySelector('[role=alert]')?.textContent).toContain('必须保留的未保存输入')
    expect(original).not.toHaveBeenCalled(); expect(late).not.toHaveBeenCalled()
    await ui.render('旧来源', late)
    expect((ui.host.querySelector('input,textarea') as HTMLInputElement)?.value).toBe('必须保留的未保存输入')
    await act(async () => { await flushPendingEditsV1() })
    expect(original).toHaveBeenCalledWith('必须保留的未保存输入')
    expect(late).not.toHaveBeenCalled()
  })

})
