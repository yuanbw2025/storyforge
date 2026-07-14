import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChapterEditorHeader from '../../src/components/editor/ChapterEditorHeader'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function mount(patch: Record<string, unknown> = {}) {
  const props = {
    title: '雨夜入城',
    wordCount: 1234,
    status: 'draft' as const,
    showContext: false,
    canCompare: true,
    saveDisabled: false,
    saving: false,
    saveError: '',
    isSaved: false,
    onStatusChange: vi.fn(),
    onToggleContext: vi.fn(),
    onOpenCompare: vi.fn(),
    onSave: vi.fn(),
    ...patch,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(ChapterEditorHeader, props)))
  return { host, props }
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.trim() === label)
  if (!match) throw new Error(`missing button: ${label}`)
  return match
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 正文编辑器标题栏', () => {
  it('展示规范标题、字数与状态，并转发状态切换', async () => {
    const { host, props } = await mount()
    expect(host.textContent).toContain('雨夜入城')
    expect(host.textContent).toContain('1,234 字')
    const status = host.querySelector('select')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(status, 'final')
      status.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(props.onStatusChange).toHaveBeenCalledWith('final')
  })

  it('转发上下文、对照润色与保存命令', async () => {
    const { host, props } = await mount()
    await act(async () => button(host, '上下文').click())
    await act(async () => button(host, '对照润色').click())
    await act(async () => button(host, '保存').click())
    expect(props.onToggleContext).toHaveBeenCalledOnce()
    expect(props.onOpenCompare).toHaveBeenCalledOnce()
    expect(props.onSave).toHaveBeenCalledOnce()
  })

  it('准确展示保存中、失败、已保存和禁用状态', async () => {
    const saving = await mount({ saving: true })
    expect(saving.host.textContent).toContain('保存中...')
    expect(button(saving.host, '保存中...').disabled).toBe(true)

    const failed = await mount({ saveError: '磁盘写入失败' })
    expect(button(failed.host, '保存失败').title).toContain('磁盘写入失败')

    const saved = await mount({ isSaved: true, canCompare: false, saveDisabled: true })
    expect(button(saved.host, '已保存').disabled).toBe(true)
    expect(button(saved.host, '对照润色').disabled).toBe(true)
  })
})
