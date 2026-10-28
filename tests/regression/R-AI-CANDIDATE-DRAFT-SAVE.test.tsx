import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AIStreamOutput from '../../src/components/shared/AIStreamOutput'
import { flushPendingEditsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
afterEach(async () => {
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})
async function mount(onSaveDraft?: (text: string) => Promise<void>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  const onAccept = vi.fn(), props = { output: '原候选', isStreaming: false, error: null, editable: true, onStop: vi.fn(), onRetry: vi.fn(), onAccept, onSaveDraft }
  const render = async (extra = {}) => act(async () => { root.render(<AIStreamOutput {...props} {...extra} />) })
  await render()
  const edit = async (value: string) => act(async () => {
    const input = host.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const button = (label: string) => [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === label)!
  return { host, render, edit, button, onAccept }
}

describe('candidate draft saving without formal adoption', () => {
  it('saves explicit edits, shows acknowledgement, and never calls formal adoption', async () => {
    const save = vi.fn().mockResolvedValue(undefined), ui = await mount(save)
    await ui.edit('作者修改候选')
    expect(ui.host.textContent).toContain('候选修改尚未保存')
    await act(async () => ui.button('保存候选修改').click())
    expect(save).toHaveBeenCalledWith('作者修改候选')
    expect(ui.onAccept).not.toHaveBeenCalled()
    expect(ui.host.textContent).toContain('候选已保存，尚未采纳')
    expect(ui.button('保存候选修改').disabled).toBe(true)
  })
  it('save failure retains editable text and retries visibly without discarding the draft', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('保存未完成')).mockResolvedValue(undefined), ui = await mount(save)
    await ui.edit('不能丢掉的修改')
    await act(async () => ui.button('保存候选修改').click())
    expect(ui.host.querySelector('textarea')?.value).toBe('不能丢掉的修改')
    expect(ui.host.querySelector('[role=alert]')?.textContent).toBe('保存未完成')
    await act(async () => ui.button('保存候选修改').click())
    expect(save).toHaveBeenCalledTimes(2)
    expect(ui.onAccept).not.toHaveBeenCalled()
  })
  it('navigation barrier saves an opt-in candidate draft before leaving', async () => {
    const save = vi.fn().mockResolvedValue(undefined), ui = await mount(save)
    await ui.edit('切页前保存')
    await act(async () => { await flushPendingEditsV1() })
    expect(save).toHaveBeenCalledWith('切页前保存')
    expect(ui.onAccept).not.toHaveBeenCalled()
  })
  it('a failing navigation barrier rejects while keeping the draft in the current editor', async () => {
    const save = vi.fn().mockRejectedValue(new Error('候选保存故障')), ui = await mount(save)
    await ui.edit('留在此页的修改')
    await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('候选保存故障') })
    expect(ui.host.querySelector('textarea')?.value).toBe('留在此页的修改')
    expect(ui.host.textContent).toContain('候选保存故障')
  })
  it('late source readback does not replace unsaved candidate edits', async () => {
    const ui = await mount(vi.fn().mockResolvedValue(undefined))
    await ui.edit('还没保存的新输入')
    await ui.render({ output: '迟到的旧候选读取' })
    expect(ui.host.querySelector('textarea')?.value).toBe('还没保存的新输入')
  })
  it('clearing the candidate retains the editor, can report validation failure, and allows typing again', async () => {
    const ui = await mount(vi.fn().mockRejectedValue(new Error('正文候选不能为空')))
    await ui.edit('')
    expect(ui.host.querySelector('textarea')).not.toBeNull()
    await act(async () => ui.button('保存候选修改').click())
    expect(ui.host.textContent).toContain('正文候选不能为空')
    await ui.edit('重新输入的候选')
    expect(ui.host.querySelector('textarea')?.value).toBe('重新输入的候选')
  })
  it('other callers do not gain a new write path without opting in', async () => {
    const ui = await mount()
    await ui.edit('仅采纳时提交的修改')
    expect(ui.button('保存候选修改')).toBeUndefined()
    await act(async () => ui.button('采纳').click())
    expect(ui.onAccept).toHaveBeenCalledWith('仅采纳时提交的修改')
  })
})
